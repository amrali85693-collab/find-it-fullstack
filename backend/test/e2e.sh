#!/bin/bash
set -uo pipefail
BASE="http://localhost:4000"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1)); echo "  PASS  $desc (got $actual)"
  else
    FAIL=$((FAIL+1)); echo "  FAIL  $desc (expected $expected, got $actual)"
  fi
}

echo "== health =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" $BASE/health)
check "GET /health" 200 "$CODE"

echo; echo "== register: valid user A (poster) =="
CODE=$(curl -s -H "Expect:" -o /tmp/regA.json -w "%{http_code}" -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Nour M","email":"nour@fci.edu","password":"password123","student_id":"20211234"}')
check "POST /auth/register (A)" 201 "$CODE"
TOKEN_A=$(jq -r .token /tmp/regA.json)
USER_A=$(jq -r .user.id /tmp/regA.json)

echo; echo "== register: valid user B (finder) =="
CODE=$(curl -s -H "Expect:" -o /tmp/regB.json -w "%{http_code}" -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Omar K","email":"omar@fci.edu","password":"password456"}')
check "POST /auth/register (B)" 201 "$CODE"
TOKEN_B=$(jq -r .token /tmp/regB.json)

echo; echo "== register: valid user C (second claimant) =="
CODE=$(curl -s -H "Expect:" -o /tmp/regC.json -w "%{http_code}" -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Yara H","email":"yara@fci.edu","password":"password789"}')
check "POST /auth/register (C)" 201 "$CODE"
TOKEN_C=$(jq -r .token /tmp/regC.json)

echo; echo "== register: duplicate email rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Dup","email":"nour@fci.edu","password":"password123"}')
check "duplicate email -> 409" 409 "$CODE"

echo; echo "== register: weak password rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Weak","email":"weak@fci.edu","password":"123"}')
check "weak password -> 400" 400 "$CODE"

echo; echo "== register: password never returned in response =="
HAS_HASH=$(jq 'has("password_hash")' /tmp/regA.json)
HAS_PW=$(jq '.user | has("password")' /tmp/regA.json)
check "no password_hash in response" false "$HAS_HASH"
check "no password field in response" false "$HAS_PW"

echo; echo "== login: correct credentials =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"nour@fci.edu","password":"password123"}')
check "POST /auth/login (correct)" 200 "$CODE"

echo; echo "== login: wrong password =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"nour@fci.edu","password":"wrongpass"}')
check "POST /auth/login (wrong pw) -> 401" 401 "$CODE"

echo; echo "== login: SQL injection attempt in email field =="
CODE=$(curl -s -H "Expect:" -o /tmp/sqli.json -w "%{http_code}" -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"' OR '1'='1\",\"password\":\"x\"}")
check "SQLi login attempt -> 401 not 500/bypass" 401 "$CODE"

echo; echo "== protected route without token =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" $BASE/auth/me)
check "GET /auth/me no token -> 401" 401 "$CODE"

echo; echo "== protected route with token =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" $BASE/auth/me -H "Authorization: Bearer $TOKEN_A")
check "GET /auth/me with token -> 200" 200 "$CODE"

echo; echo "== create lost item (user A, no auth) should fail =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/items \
  -F "title=AirPods" -F "category=electronics" -F "location=Room 204" -F "item_date=2026-08-14" \
  -F "type=lost" -F "contact_info=nour_m")
check "create item no auth -> 401" 401 "$CODE"

echo; echo "== create lost item (user A, authenticated) =="
CODE=$(curl -s -H "Expect:" -o /tmp/itemA.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_A" \
  -F "title=AirPods" -F "category=electronics" -F "location=Room 204" -F "item_date=2026-08-14" \
  -F "description=White case, small scratch" -F "type=lost" -F "contact_info=nour_m")
check "create lost item -> 201" 201 "$CODE"
ITEM_A=$(jq -r .item.id /tmp/itemA.json)
check "new item starts as status=active" "active" "$(jq -r .item.status /tmp/itemA.json)"

echo; echo "== create item: missing required field rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_A" \
  -F "title=" -F "category=electronics" -F "location=Room 204" -F "item_date=2026-08-14" \
  -F "type=lost" -F "contact_info=nour_m")
check "empty title -> 400" 400 "$CODE"

echo; echo "== create item: invalid category rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_A" \
  -F "title=Thing" -F "category=not_a_real_category" -F "location=Room 204" -F "item_date=2026-08-14" \
  -F "type=lost" -F "contact_info=x")
check "invalid category -> 400" 400 "$CODE"

echo; echo "== create item: XSS payload in title is stored verbatim (escaping is a render-time responsibility) =="
CODE=$(curl -s -H "Expect:" -o /tmp/xss.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_A" \
  --form-string 'title=<script>alert(1)</script>' -F "category=other" -F "location=Lab" -F "item_date=2026-08-14" \
  -F "type=lost" -F "contact_info=x")
check "XSS-payload title accepted as data -> 201" 201 "$CODE"
STORED_TITLE=$(jq -r .item.title /tmp/xss.json)
check "stored exactly (no silent mutation)" '<script>alert(1)</script>' "$STORED_TITLE"

echo; echo "== create found item (user B) =="
CODE=$(curl -s -H "Expect:" -o /tmp/itemB.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_B" \
  -F "title=AirPods" -F "category=electronics" -F "location=Room 204" -F "item_date=2026-08-14" \
  -F "description=Found near the door" -F "type=found" -F "contact_info=omar.k@fci.edu")
check "create found item -> 201" 201 "$CODE"
ITEM_B=$(jq -r .item.id /tmp/itemB.json)

echo; echo "== image upload: reject non-image file =="
echo "not an image" > /tmp/fake.txt
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_A" \
  -F "title=Bad Upload" -F "category=other" -F "location=X" -F "item_date=2026-08-14" \
  -F "type=lost" -F "contact_info=x" -F "image=@/tmp/fake.txt;type=text/plain")
check "non-image upload -> 400" 400 "$CODE"

echo; echo "== image upload: accept a real small PNG, served back statically =="
python3 -c "
import struct, zlib
def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
sig = b'\x89PNG\r\n\x1a\n'
ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
raw = b'\x00\xff\x00\x00'
idat = chunk(b'IDAT', zlib.compress(raw))
iend = chunk(b'IEND', b'')
open('/tmp/tiny.png','wb').write(sig+ihdr+idat+iend)
"
CODE=$(curl -s -H "Expect:" -o /tmp/imgitem.json -w "%{http_code}" -X POST $BASE/items -H "Authorization: Bearer $TOKEN_A" \
  -F "title=Blue Water Bottle" -F "category=accessories" -F "location=Library" -F "item_date=2026-08-14" \
  -F "type=found" -F "contact_info=x" -F "image=@/tmp/tiny.png;type=image/png")
check "real PNG upload -> 201" 201 "$CODE"
IMG_URL=$(jq -r .item.image_url /tmp/imgitem.json)
IMG_CODE=$(curl -s -H "Expect:" -o /dev/null -w "%{http_code}" "$BASE$IMG_URL")
check "uploaded image is retrievable" 200 "$IMG_CODE"
IMG_FILENAME=$(basename "$IMG_URL")
check "stored filename is NOT the original name" "true" "$([ "$IMG_FILENAME" != "tiny.png" ] && echo true || echo false)"

echo; echo "== list items: filter type=lost =="
CODE=$(curl -s -H "Expect:" -o /tmp/list.json -w "%{http_code}" "$BASE/items?type=lost")
check "GET /items?type=lost -> 200" 200 "$CODE"

echo; echo "== search: keyword search finds AirPods across lost+found =="
CODE=$(curl -s -H "Expect:" -o /tmp/search.json -w "%{http_code}" "$BASE/items?q=AirPods")
check "GET /items?q=AirPods -> 200" 200 "$CODE"
SEARCH_COUNT=$(jq '.items | length' /tmp/search.json)
check "search finds both AirPods posts" 2 "$SEARCH_COUNT"

echo; echo "== search: SQL injection in q param does not error or leak =="
CODE=$(curl -s -H "Expect:" -o /tmp/sqli2.json -w "%{http_code}" -G "$BASE/items" --data-urlencode "q=' OR '1'='1")
check "SQLi in search -> 200 (parameterized, not 500)" 200 "$CODE"

echo; echo "== pagination: pageSize respected =="
CODE=$(curl -s -H "Expect:" -o /tmp/page.json -w "%{http_code}" "$BASE/items?pageSize=1&page=1")
PAGE_LEN=$(jq '.items | length' /tmp/page.json)
check "pageSize=1 returns exactly 1 item" 1 "$PAGE_LEN"

echo; echo "== get single item: contact_info hidden for anonymous request =="
CODE=$(curl -s -H "Expect:" -o /tmp/anon.json -w "%{http_code}" "$BASE/items/$ITEM_A")
HAS_CONTACT=$(jq '.item | has("contact_info")' /tmp/anon.json)
check "anonymous GET hides contact_info" false "$HAS_CONTACT"

echo; echo "== get single item: contact_info visible when authenticated =="
CODE=$(curl -s -H "Expect:" -o /tmp/auth_get.json -w "%{http_code}" "$BASE/items/$ITEM_A" -H "Authorization: Bearer $TOKEN_B")
HAS_CONTACT2=$(jq '.item | has("contact_info")' /tmp/auth_get.json)
check "authenticated GET includes contact_info" true "$HAS_CONTACT2"

echo; echo "== authorization: user B cannot edit user A's item =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/items/$ITEM_A" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d '{"title":"Hijacked"}')
check "cross-user edit -> 403" 403 "$CODE"

echo; echo "== authorization: user B cannot delete user A's item =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X DELETE "$BASE/items/$ITEM_A" -H "Authorization: Bearer $TOKEN_B")
check "cross-user delete -> 403" 403 "$CODE"

echo; echo "== authorization: user B cannot mark A's item returned =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/items/$ITEM_A/return" -H "Authorization: Bearer $TOKEN_B")
check "cross-user mark-returned -> 403" 403 "$CODE"

echo; echo "== owner CAN edit their own item =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/items/$ITEM_B" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d '{"description":"Updated description"}')
check "owner edit -> 200" 200 "$CODE"

# ---------------------------------------------------------------------
# Claim -> Verify -> Return lifecycle (tightened transitions)
# ---------------------------------------------------------------------

echo; echo "== claims: user cannot claim their own item =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/claims" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_A\"}")
check "self-claim -> 400" 400 "$CODE"

echo; echo "== claims: user B claims user A's active lost item =="
CODE=$(curl -s -H "Expect:" -o /tmp/claim.json -w "%{http_code}" -X POST "$BASE/claims" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_A\",\"message\":\"That is mine, has a scratch on the case\"}")
check "create claim -> 201" 201 "$CODE"
CLAIM_ID=$(jq -r .claim.id /tmp/claim.json)
check "new claim starts pending" "pending" "$(jq -r .claim.status /tmp/claim.json)"

echo; echo "== claims: same user cannot double-claim the same item while pending =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/claims" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_A\"}")
check "duplicate pending claim -> 409" 409 "$CODE"

echo; echo "== claims: a second user (C) can also file a competing claim =="
CODE=$(curl -s -H "Expect:" -o /tmp/claimC.json -w "%{http_code}" -X POST "$BASE/claims" -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_A\",\"message\":\"I think I found this too\"}")
check "second competing claim -> 201" 201 "$CODE"
CLAIM_ID_C=$(jq -r .claim.id /tmp/claimC.json)

echo; echo "== claims: non-owner (B) cannot approve their own claim on A's item =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/claims/$CLAIM_ID" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d '{"status":"approved"}')
check "claimant cannot self-approve -> 403" 403 "$CODE"

echo; echo "== claims: invalid status value rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/claims/$CLAIM_ID" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"status":"maybe"}')
check "invalid claim status -> 400" 400 "$CODE"

echo; echo "== claims: item owner (A) CAN approve B's claim =="
CODE=$(curl -s -H "Expect:" -o /tmp/approve.json -w "%{http_code}" -X PUT "$BASE/claims/$CLAIM_ID" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"status":"approved"}')
check "owner approves claim -> 200" 200 "$CODE"
check "approved claim status reflects it" "approved" "$(jq -r .claim.status /tmp/approve.json)"

echo; echo "== items: approving a claim moves the item to status=matched =="
CODE=$(curl -s -H "Expect:" -o /tmp/afterapprove.json -w "%{http_code}" "$BASE/items/$ITEM_A" -H "Authorization: Bearer $TOKEN_A")
check "item status is now matched" "matched" "$(jq -r .item.status /tmp/afterapprove.json)"

echo; echo "== claims: approving auto-rejects the other competing pending claim (C) =="
CODE=$(curl -s -H "Expect:" -o /tmp/claimsforitem.json -w "%{http_code}" "$BASE/claims/item/$ITEM_A" -H "Authorization: Bearer $TOKEN_A")
C_STATUS=$(jq -r --arg id "$CLAIM_ID_C" '.claims[] | select(.id==$id) | .status' /tmp/claimsforitem.json)
check "competing claim auto-rejected" "rejected" "$C_STATUS"

echo; echo "== claims: cannot re-decide an already-decided claim =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/claims/$CLAIM_ID" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"status":"rejected"}')
check "double-decide same claim -> 409" 409 "$CODE"

echo; echo "== claims: cannot claim an item that is no longer active (now matched) =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/claims" -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_A\"}")
check "claim on matched item -> 409" 409 "$CODE"

echo; echo "== items: owner CAN mark a matched item as returned =="
CODE=$(curl -s -H "Expect:" -o /tmp/ret.json -w "%{http_code}" -X PUT "$BASE/items/$ITEM_A/return" -H "Authorization: Bearer $TOKEN_A")
check "owner mark-returned from matched -> 200" 200 "$CODE"
check "status becomes 'returned'" "returned" "$(jq -r .item.status /tmp/ret.json)"

echo; echo "== items: cannot mark already-returned item returned again (race-safe atomic guard) =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/items/$ITEM_A/return" -H "Authorization: Bearer $TOKEN_A")
check "double return -> 409" 409 "$CODE"

echo; echo "== claims: cannot claim a returned item =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/claims" -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_A\"}")
check "claim on returned item -> 409" 409 "$CODE"

echo; echo "== claims: My Claims view (B) shows the approved claim =="
CODE=$(curl -s -H "Expect:" -o /tmp/myclaims.json -w "%{http_code}" "$BASE/claims/mine" -H "Authorization: Bearer $TOKEN_B")
check "GET /claims/mine -> 200" 200 "$CODE"
check "B's claim on item A shows approved" "approved" "$(jq -r --arg id "$CLAIM_ID" '.claims[] | select(.id==$id) | .status' /tmp/myclaims.json)"

echo; echo "== items: My Items view (A) lists their post =="
CODE=$(curl -s -H "Expect:" -o /tmp/myitems.json -w "%{http_code}" "$BASE/items/mine" -H "Authorization: Bearer $TOKEN_A")
check "GET /items/mine -> 200" 200 "$CODE"
check "A's items include item A" "true" "$(jq --arg id "$ITEM_A" '[.items[].id] | index($id) != null' /tmp/myitems.json)"

echo; echo "== matching: possible-match suggestions for the found AirPods item =="
CODE=$(curl -s -H "Expect:" -o /tmp/matches.json -w "%{http_code}" "$BASE/matches/for/$ITEM_B" -H "Authorization: Bearer $TOKEN_B")
check "GET /matches/for -> 200" 200 "$CODE"

# ---------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------

echo; echo "== reports: user C reports item B's found post =="
CODE=$(curl -s -H "Expect:" -o /tmp/report.json -w "%{http_code}" -X POST "$BASE/reports" -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_B\",\"reason\":\"This looks like a duplicate post\"}")
check "create report -> 201" 201 "$CODE"
REPORT_ID=$(jq -r .report.id /tmp/report.json)
check "new report starts open" "open" "$(jq -r .report.status /tmp/report.json)"

echo; echo "== reports: empty reason rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/reports" -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" -d "{\"item_id\":\"$ITEM_B\",\"reason\":\"\"}")
check "empty reason -> 400" 400 "$CODE"

echo; echo "== reports: non-admin cannot list all reports =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" "$BASE/reports" -H "Authorization: Bearer $TOKEN_C")
check "non-admin GET /reports -> 403" 403 "$CODE"

# ---------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------

echo; echo "== admin: regular user forbidden from admin stats =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" "$BASE/admin/stats" -H "Authorization: Bearer $TOKEN_A")
check "non-admin GET /admin/stats -> 403" 403 "$CODE"

echo; echo "== admin: promote user A to admin directly in DB, then verify access =="
su - postgres -c "psql -d find_it -c \"UPDATE users SET role='admin' WHERE id='$USER_A';\"" > /dev/null
CODE=$(curl -s -H "Expect:" -o /tmp/adminstats.json -w "%{http_code}" "$BASE/admin/stats" -H "Authorization: Bearer $TOKEN_A")
check "same token after DB role promotion -> 200 (role re-checked from DB, not trusted from JWT)" 200 "$CODE"
cat /tmp/adminstats.json; echo

echo; echo "== admin: resolve the open report on item B =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/reports/$REPORT_ID" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"status":"resolved"}')
check "admin resolves report -> 200" 200 "$CODE"

echo; echo "== admin: list users =="
CODE=$(curl -s -H "Expect:" -o /tmp/users.json -w "%{http_code}" "$BASE/admin/users" -H "Authorization: Bearer $TOKEN_A")
check "GET /admin/users -> 200" 200 "$CODE"
check "at least 3 users listed" "true" "$(jq '(.users | length) >= 3' /tmp/users.json)"

echo; echo "== admin: change user C's role to admin =="
USER_C=$(jq -r '.user.id' /tmp/regC.json)
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/admin/users/$USER_C/role" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"role":"admin"}')
check "admin promotes user -> 200" 200 "$CODE"

echo; echo "== admin: invalid role rejected =="
CODE=$(curl -s -H "Expect:" -o /tmp/out.json -w "%{http_code}" -X PUT "$BASE/admin/users/$USER_C/role" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"role":"superuser"}')
check "invalid role -> 400" 400 "$CODE"

echo
echo "=============================="
echo "PASSED: $PASS   FAILED: $FAIL"
echo "=============================="
