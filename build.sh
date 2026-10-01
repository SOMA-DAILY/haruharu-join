#!/bin/zsh
# apply3 빌드: src/form.template.html → public/seoul/index.html, public/gwangju/index.html
# 기수 바뀌면 아래 변수만 고치고 다시 실행. Mixpanel 토큰은 FE .env.production 에서 읽음 (파일에 박지 않음)
set -e
cd "$(dirname "$0")"
COHORT="3"
FEE_REGULAR="7,900";  PAY_REGULAR="https://haruharu-pay.pages.dev/j/"
FEE_EARLY="4,900";    PAY_EARLY="https://haruharu-pay.pages.dev/e/"
EARLY_DIR="pre-4k9x"   # 사전알림 신청자에게만 보내는 폼 경로. 광고/바이오에 쓰지 말 것
SCHEDULE_SEOUL="- 진행 기간: 10월 6일(화) ~ 10월 8일(목), 3일\n- 신청 마감: 10월 5일(월)\n- 참가비: __FEE__원\n- 최종 참가 안내 문자: 신청 마감일 밤"
SCHEDULE_GWANGJU="$SCHEDULE_SEOUL"
IMG_P1_SEOUL="P1_seoul_3gi.png";     IMG_P1_GWANGJU="P1_gwangju_3gi.png"
# P4 는 지역 x 요금제 4장: P4_{city}_3gi_{regular|early}_12900.png
MP="${MIXPANEL_TOKEN:-$(grep -h "EXPO_PUBLIC_MIXPANEL_TOKEN=" ~/project/haruharu-FE/.env.production 2>/dev/null | cut -d= -f2 | tr -d '"\r')}"  # CI 는 MIXPANEL_TOKEN 시크릿
[ -n "$MP" ] || { echo "Mixpanel 토큰을 못 읽음"; exit 1; }

gen() { # city city_ko school_ex img_p1 schedule plan fee pay_url outdir fee_note
  mkdir -p "public/$9"
  python3 - "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" "${10}" "$COHORT" "$MP" <<'EOF'
import sys, re, os
city,city_ko,school,p1,sched,plan,fee,pay,outdir,fee_note,cohort,mp=sys.argv[1:]
p4=f'P4_{city}_3gi_{plan}_12900.png'
if plan == 'early':
    sched=sched.replace('- 신청 마감: 10월 5일(월)\\n', '').replace('- 최종 참가 안내 문자: 신청 마감일 밤', '- 인원이 구성되면 안내 문자를 보내드려요.')
t=open('src/form.template.html',encoding='utf-8').read()
for k,v in {'__CITY__':city,'__CITY_KO__':city_ko,'__SCHOOL_EX__':school,'__IMG_P1__':p1,'__IMG_P4__':p4,'__SCHEDULE__':sched.replace('\\n','\n'),'__COHORT__':cohort,'__PLAN__':plan,'__FEE_NOTE__':fee_note,'__PAY_URL__':pay,'__FEE__':fee,'__MP__':mp}.items():
    t=t.replace(k,v)
if plan == 'early':
    start=t.index('<div class="q" data-name="source">')
    end=t.index('<div class="q" data-name="intent">', start)
    t=t[:start]+t[end:]
    card=open('src/early-info.html',encoding='utf-8').read().replace('__CITY_KO__',city_ko).replace('__COHORT__',cohort)
    t=re.sub(r'<img class="img" data-img="P4"[^>]+>',card,t)
    t=t.replace('id="pay" href="'+pay+'"', 'id="pay" aria-disabled="true"').replace('id="submit"', 'id="submit" disabled')
    t=t.replace('방이 열리면 초대 코드를 문자로 보내드려요.', '인원이 구성되면 안내 문자와 초대 코드를 보내드려요.')
left=re.findall(r'__[A-Z0-9_]+__',t)
assert not left, 'placeholder 남음: '+str(left)
assert os.path.exists('public/img/'+p4), 'P4 이미지 없음: '+p4
open(f'public/{outdir}/index.html','w',encoding='utf-8').write(t)
print('built', outdir, plan, fee, len(t))
EOF
}
NOTE_REGULAR="참가비는 ${FEE_REGULAR}원이에요. 송금까지 마쳐야 신청이 완료돼요."
NOTE_EARLY="사전 알림을 신청해 주신 분은 ${FEE_EARLY}원에 참여할 수 있어요. 송금까지 마쳐야 신청이 완료돼요."
gen seoul   "서울" "서울대학교" "$IMG_P1_SEOUL"   "$SCHEDULE_SEOUL"   regular "$FEE_REGULAR" "$PAY_REGULAR" "seoul"              "$NOTE_REGULAR"
gen gwangju "광주" "전남대학교" "$IMG_P1_GWANGJU" "$SCHEDULE_GWANGJU" regular "$FEE_REGULAR" "$PAY_REGULAR" "gwangju"            "$NOTE_REGULAR"
gen seoul   "서울" "서울대학교" "$IMG_P1_SEOUL"   "$SCHEDULE_SEOUL"   early   "$FEE_EARLY"   "$PAY_EARLY"   "seoul/$EARLY_DIR"   "$NOTE_EARLY"
gen gwangju "광주" "전남대학교" "$IMG_P1_GWANGJU" "$SCHEDULE_GWANGJU" early   "$FEE_EARLY"   "$PAY_EARLY"   "gwangju/$EARLY_DIR" "$NOTE_EARLY"
cp src/early-offer.js public/early-offer.js
# 전남대 축제 이벤트 폼 (/jnu-festival/). 지역 선택(/)에는 안 걸고 링크로만 보냄. 마감 시각은 shared/jnu-festival.mjs 한 곳에서 읽음
FEST_DIR="jnu-festival"; FEE_FEST="4,900"; FEE_FEST_ORIG="12,900"; PAY_FEST="https://haruharu-pay.pages.dev/f/"   # 축제 전용 셀(haruharu-pay /f/). /e/ 를 닫아도 영향 없음
FEST_DEADLINE_KO="10월 3일(토) 오후 6시"
FEST_DEADLINE="$(sed -n "s/^export const FESTIVAL_DEADLINE = '\(.*\)';$/\1/p" shared/jnu-festival.mjs)"
[ -n "$FEST_DEADLINE" ] || { echo "축제 마감 시각을 못 읽음"; exit 1; }
mkdir -p "public/$FEST_DIR"
python3 - "$FEST_DIR" "$FEE_FEST" "$PAY_FEST" "$FEST_DEADLINE" "$FEST_DEADLINE_KO" "$MP" "$FEE_FEST_ORIG" <<'EOF3'
import sys, re, os
from datetime import datetime
outdir,fee,pay,deadline,deadline_ko,mp,fee_orig=sys.argv[1:]
ms=int(datetime.fromisoformat(deadline).timestamp()*1000)
t=open('src/festival.template.html',encoding='utf-8').read()
for k,v in {'__CITY__':'gwangju','__CITY_KO__':'광주','__COHORT__':'jnu-festival','__PLAN__':'jnu_festival','__DEADLINE_MS__':str(ms),'__DEADLINE_KO__':deadline_ko,
            '__FEE_NOTE__':f'참가비는 {fee}원이에요. 송금까지 마쳐야 신청이 완료돼요.','__PAY_URL__':pay,'__FEE__':fee,'__FEE_ORIG__':fee_orig,'__MP__':mp}.items():
    t=t.replace(k,v)
left=re.findall(r'__[A-Z0-9_]+__',t)
assert not left, 'placeholder 남음: '+str(left)
bad=[c for c in '·「」①②③④⑤' if c in t]
assert not bad, '금지 문자: '+str(bad)
for img in re.findall(r'src="/img/([^"]+)"',t):
    assert os.path.exists('public/img/'+img), '이미지 없음: '+img
open(f'public/{outdir}/index.html','w',encoding='utf-8').write(t)
print('built', outdir, 'jnu_festival', fee, 'deadline', deadline, ms, len(t))
EOF3
# 지역 선택 페이지 (루트)
python3 - "$MP" <<'EOF2'
import sys
t=open('src/select.template.html',encoding='utf-8').read().replace('__MP__',sys.argv[1])
open('public/index.html','w',encoding='utf-8').write(t); print('built select', len(t))
EOF2
# 이미지는 템플릿에서 /img/ 절대경로로 참조 (하위 경로 폼이 생겨서)
mkdir -p public/admin && cp src/admin.html public/admin/index.html
echo "done. deploy: npx wrangler pages deploy public --project-name haruharu-apply"
