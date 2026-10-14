#!/bin/zsh
# apply3 빌드: shared/forms.mjs 등록부의 폼마다 src/form.template.html → public/{경로}/index.html
# 기수/금액/일정/마감은 전부 shared/forms.mjs 한 곳. 여기엔 이미지 파일명과 문구 조각만.
# Mixpanel 토큰은 FE .env.production 에서 읽음 (파일에 박지 않음). CI 는 MIXPANEL_TOKEN 시크릿
set -e
cd "$(dirname "$0")"
MP="${MIXPANEL_TOKEN:-$(grep -h "EXPO_PUBLIC_MIXPANEL_TOKEN=" ~/project/haruharu-FE/.env.production 2>/dev/null | cut -d= -f2 | tr -d '"\r')}"
[ -n "$MP" ] || { echo "Mixpanel 토큰을 못 읽음"; exit 1; }
# 등록부를 JSON 으로 (node 는 CI 에 있음)
REG="$(node --input-type=module -e "import('./shared/forms.mjs').then(m=>console.log(JSON.stringify({FORMS:m.FORMS,CURRENT:m.CURRENT_COHORT,DEADLINES:m.COHORT_DEADLINES,DEADLINE_KO:m.COHORT_DEADLINE_KO,INFO:m.COHORT_INFO})))")"
[ -n "$REG" ] || { echo "등록부를 못 읽음"; exit 1; }
export MP REG
python3 - <<'EOF'
import os, re, json
from datetime import datetime
R=json.loads(os.environ['REG']); MP=os.environ['MP']
FORMS, CUR, DL, DLKO, INFO = R['FORMS'], R['CURRENT'], R['DEADLINES'], R['DEADLINE_KO'], R['INFO']
# 개선판(등록부에 variant 가 있는 줄)은 맨 끝에서 build-v2.sh 가 따로 만듦. 여기서는 기존 폼만 다뤄서 기존 화면이 한 글자도 안 바뀌게 함
ALL_FORMS = FORMS; FORMS = {p: f for p, f in FORMS.items() if not f.get('variant')}
TPL=open('src/form.template.html',encoding='utf-8').read()
CARD=open('src/info-card.html',encoding='utf-8').read()
EARLY_CARD=open('src/early-info.html',encoding='utf-8').read()
LANDING=open('src/landing.html',encoding='utf-8').read()
DONE_SURVEY=open('src/done-survey.html',encoding='utf-8').read()
BAD='·「」①②③④⑤'

def NEWGEN(c): return str(c).isdigit() and int(c) >= 4   # 4기부터 쓰는 화면(실적 220명판 P1, 완료 설문). 5기 이후도 같음
def ms(iso): return str(int(datetime.fromisoformat(iso).timestamp()*1000))

def next_path(f):
    if f['cohort']==CUR: return None
    for p,g in FORMS.items():
        if g['cohort']==CUR and g.get('track')==f.get('track') and g['plan']=='regular': return p
    # 기존판이 없는 기수(6기~ 개선판만)는 고정 링크가 가리키는 폼으로 (10/14)
    for p,g in ALL_FORMS.items():
        if g['cohort']==CUR and g.get('track')==f.get('track') and g['plan']=='regular' and g.get('entry'): return p
    return '/'

# 트랙별 문구
def school_q(f):
    if f.get('occupation'):
        # 10/7: 선택지 → 주관식 (레퍼런스 전부 직업 자유기입, 같은 회사 배정 피하기 용도 겸함). 서버 칸은 school 그대로
        return '<div class="q" data-name="school"><p class="t">하시는 일<span class="req">*</span></p>\n <input type="text" name="school" placeholder="ex) IT 회사 개발자, 간호사, 초등학교 교사" required><p class="err">하시는 일을 입력해 주세요</p></div>'
    return f'<div class="q" data-name="school"><p class="t">학교<span class="req">*</span></p>\n <input type="text" name="school" placeholder="ex) {f.get("schoolEx","")}" required><p class="err">학교를 입력해 주세요</p></div>'

def extra_q(f):
    if not f.get('occupation'): return ''
    return ('<div class="q" data-name="schedule_pref"><p class="t">편한 진행 시기<span class="req">*</span></p>\n <div class="opts">\n'
            '  <label class="opt"><span class="k">A</span><input type="radio" name="schedule_pref" value="평일 3일도 괜찮아요" required>평일 3일도 괜찮아요</label>\n'
            '  <label class="opt"><span class="k">B</span><input type="radio" name="schedule_pref" value="주말이 하루는 껴야 해요">주말이 하루는 껴야 해요</label>\n'
            ' </div><p class="err">선택해 주세요</p></div>\n')

def gen(path, f):
    cohort, plan = f['cohort'], f['plan']
    outdir = 'public' + path
    os.makedirs(outdir, exist_ok=True)
    work = bool(f.get('occupation'))
    prealert = plan == 'prealert'
    fee = f"{f['fee']:,}"
    info = dict(INFO.get(cohort, {}), **({'period': f['period']} if f.get('period') else {}))   # 트랙별 일정이 따로 있으면 그걸로 (직장인 10월 중순)
    target_ko = f['cityKo'] + (' 직장인' if work else ' 대학생')
    region = '수도권' if f['city'] == 'seoul' else f['cityKo']   # 랜딩 표기: 서울 트랙은 수도권 (10/7)
    deadline_iso = None if f.get('noDeadline') else DL.get(cohort); deadline_ms = ms(deadline_iso) if deadline_iso else '9e15'
    deadline_ko = DLKO.get(cohort, '')
    # 일정 문구
    if prealert:
        sched = f"- 진행 예정: {info.get('period','추후 안내')}\n- 사전 알림 신청자에게 먼저 안내 문자를 보내드려요\n- 사전 알림 신청자는 참가비 할인 혜택이 있어요"
    elif plan == 'early':
        sched = f"- 진행 기간: {info.get('period','')}\n- 참가비: {fee}원\n- 인원이 구성되면 안내 문자를 보내드려요."
    else:
        sched = f"- 진행 기간: {info.get('period','')}\n- 신청 마감: {deadline_ko}\n- 참가비: {fee}원\n- 최종 참가 안내 문자: 신청 마감일 밤"
    if prealert:
        fee_note = '사전 알림은 무료예요. 일정이 확정되면 문자로 할인 신청 링크를 보내드려요.'
        flow = '1. 이 폼을 작성하고 제출해요.\n2. 일정이 확정되면 문자로 안내와 할인 신청 링크를 보내드려요.\n3. 참가비 송금 후 신청하면 방이 열릴 때 초대 코드를 받아요.'
        done_title, done_body = '사전 알림이 접수됐어요 💌', '일정이 확정되면 문자로 안내와 할인 신청 링크를 보내드려요.'
        consent = '성별, 출생연도, 전화번호, 하시는 일'
    else:
        fee_note = (f'사전 알림을 신청해 주신 분은 {fee}원에 참여할 수 있어요. 송금까지 마쳐야 신청이 완료돼요.' if plan in ('early','discount')
                    else f'참가비는 {fee}원이에요. 송금까지 마쳐야 신청이 완료돼요.')
        flow = '1. 이 폼을 작성하고 참가비를 송금한 뒤 제출해요.\n2. 방이 열리면 초대 코드를 문자로 보내드려요.\n3. 앱에 코드를 넣으면 시작이에요.'
        done_title, done_body = '신청이 접수됐어요 💌', '방이 열리면 초대 코드를 문자로 보내드려요.'
        consent = ('성별, 출생연도, 전화번호, 하시는 일, 신청자 확인용 이름, 함께 신청한 친구의 전화번호' if work
                   else '성별, 출생년도, 전화번호, 학교, 신청자 확인용 이름, 함께 신청한 친구의 전화번호')
    nxt = next_path(f)
    next_link = (f'<p style="margin-top:14px"><a class="btn" href="{nxt}?src=h{CUR}-{f.get("track","")}-from{cohort}" style="display:inline-flex">{CUR}기 신청하러 가기 →</a></p>' if nxt else '')
    p1 = f'P1_{f["city"]}_work_4gi.png' if work else (f'P1_{f["city"]}_4gi.png' if NEWGEN(cohort) else f'P1_{f["city"]}_3gi.png')   # 4기부터 실적 220명/매칭률 34% 판(10/6). 3기 이미지는 그대로
    t = TPL
    # 랜딩판(10/7 Figma F1): 옛 머리말 + P1~P4 + 소개 문단 자리를 통째로 교체
    if f.get('landing'):
        t = re.sub(r'<!--TOP_START-->.*?<!--TOP_END-->', lambda m: LANDING, t, flags=re.S)
    else:
        t = t.replace('<!--TOP_START-->\n', '').replace('<!--TOP_END-->\n', '')
    for k, v in {
        '__CITY__': f['city'], '__CITY_KO__': f['cityKo'], '__TARGET_KO__': target_ko, '__TARGET_SHORT__': ('직장인' if work else '대학생'),
        '__TRACK__': f.get('track',''),
        '__LD_EYE__': f"하루하루 소개팅 {cohort}기 " + ('사전 알림' if prealert else '신청'),
        '__LD_CTA__': ('사전 알림 신청하기 💌' if prealert else '소개팅 신청하기 💌'),
        '__LD_TITLE__': f"솔로인 {region} {'직장인' if work else '대학생'}을 모집합니다",
        '__LD_CHIP__': (f"{region}에 거주하는 솔로 직장인끼리 모여요 💕" if work else f"00년생~07년생 {region} 대학생끼리 모여요 💕"), '__IMG_P1__': p1, '__SCHEDULE__': sched, '__COHORT__': cohort, '__PLAN__': plan,
        '__FEE_NOTE__': fee_note, '__PAY_URL__': f.get('pay') or '#', '__FEE__': fee, '__MP__': MP,
        '__DEADLINE_MS__': deadline_ms, '__DEADLINE_KO__': deadline_ko, '__NEXT_LINK__': next_link, '__FLOW__': flow,
        '__SCHOOL_Q__': school_q(f), '__SOURCE_D__': ('블라인드' if work else '에브리타임'), '__EXTRA_Q__': extra_q(f),
        '__DONE_SURVEY__': (DONE_SURVEY if NEWGEN(cohort) else ''),   # 4기 폼 전부 완료 화면 선택 문항 (10/7)
        '__CONSENT_ITEMS__': consent, '__DONE_TITLE__': done_title, '__DONE_BODY__': done_body,
    }.items():
        t = t.replace(k, v)
    # P4 이미지 자리: 3기는 기존 이미지(값이 박혀 있음), 4기부터는 글자 카드 (기수값은 HTML 에만)
    if cohort == '3' and plan != 'early':
        p4 = f'P4_{f["city"]}_3gi_{plan if plan!="discount" else "discount"}_12900.png'
        assert os.path.exists('public/img/' + p4), 'P4 이미지 없음: ' + p4
        t = t.replace('__IMG_P4__', p4)
    else:
        if plan == 'early':
            card = EARLY_CARD.replace('__CITY_KO__', f['cityKo']).replace('__COHORT__', cohort)
        else:
            notice = ('일정이 확정되면 문자로 안내해요.' if prealert else '인원이 구성되면 안내 문자와 초대 코드를 보내드려요.')
            howto = flow.replace('\n', '<br>')
            refund = '' if prealert else '인원이 안 맞아 방이 열리지 않으면 참가비를 전액 돌려드려요.'
            card = (CARD.replace('__COHORT__', cohort).replace('__TARGET_KO__', target_ko).replace('__PERIOD__', info.get('period','추후 안내'))
                    .replace('__NOTICE__', notice).replace('__HOWTO__', howto).replace('__REFUND__', refund))
        t = re.sub(r'<img class="img" data-img="P4"[^>]+>', lambda m: card, t)
    if plan == 'early':
        # 3기 사전알림 할인판: 유입경로 문항 없음, 송금 버튼은 /early-offer.js 가 켬
        start = t.index('<div class="q" data-name="source">'); end = t.index('<div class="q" data-name="intent">', start)
        t = t[:start] + t[end:]
        t = t.replace('id="pay" href="' + f['pay'] + '"', 'id="pay" aria-disabled="true"').replace('id="submit"', 'id="submit" disabled')
        t = t.replace('방이 열리면 초대 코드를 문자로 보내드려요.', '인원이 구성되면 안내 문자와 초대 코드를 보내드려요.')
    if prealert:
        # 무료 사전알림: 참가비 블록 + 친구 블록 제거, 기기 문항도 제거
        t = re.sub(r'<!--PAY_START-->.*?<!--PAY_END-->', '', t, flags=re.S)
        start = t.index('<div class="q" data-name="device">'); end = t.index('<div class="q" data-name="intent">', start)
        t = t[:start] + t[end:]
        t = t.replace('<script src="/early-offer.js"></script>', '')
    else:
        t = t.replace('<!--PAY_START-->', '').replace('<!--PAY_END-->', '')
    left = re.findall(r'__[A-Z0-9_]+__', t)
    assert not left, f'{path} placeholder 남음: {left}'
    bad = [c for c in BAD if c in t.replace('받은 질문 · 1','')]
    assert not bad, f'{path} 금지 문자: {bad}'
    for img in re.findall(r'src="/img/([^"]+)"', t):
        assert os.path.exists('public/img/' + img), f'{path} 이미지 없음: {img}'
    open(outdir + 'index.html', 'w', encoding='utf-8').write(t)
    print('built', path, cohort, plan, fee, len(t))

for path, f in FORMS.items():
    if f.get('festival') or f.get('noPage'): continue   # noPage: 화면 없이 API 로만 받는 경로 (다음 기수 알림 /alert/seoul/, 10/11)
    gen(path, f)

# 지역 선택 페이지 (루트): 현재 기수의 listed 폼만 버튼으로
sel = open('src/select.template.html', encoding='utf-8').read()
listed = [(p, f) for p, f in ALL_FORMS.items() if (f['cohort'] == CUR or f.get('noDeadline')) and f.get('listed')]
listed.sort(key=lambda x: x[1].get('plan') == 'prealert')   # 학생 먼저, 직장인 사전알림 뒤   # 5기부터 개선판도 버튼에 (10/10)
def btn(p, f):   # 10/6: 직장인 사전알림도 선택 화면에. 금액 표기 없음
    if f.get('plan') == 'prealert':
        return f' <a class="b" href="{p}" data-city="{f["city"]}"><span class="t"><b>{f["cityKo"]} 직장인 사전 알림</b><span>사전 알림 신청하면 참가비 할인 혜택</span></span><span class="ar">→</span></a>'
    return f' <a class="b" href="{p}" data-city="{f["city"]}"><span class="t"><b>{f["cityKo"]} 대학생 소개팅 신청</b><span>{f["cityKo"]} 대학생</span></span><span class="ar">→</span></a>'
btns = '\n'.join(btn(p, f) for p, f in listed)
sel = (sel.replace('__MP__', MP).replace('__COHORT__', CUR).replace('__DEADLINE_MS__', (ms(DL[CUR]) if DL.get(CUR) else '9e15')).replace('__DEADLINE_KO__', DLKO[CUR]).replace('__BUTTONS__', btns))
left = re.findall(r'__[A-Z0-9_]+__', sel); assert not left, 'select placeholder 남음: ' + str(left)
open('public/index.html', 'w', encoding='utf-8').write(sel); print('built select', len(sel), [p for p, _ in listed])
# 관리 페이지: 등록부 JSON 을 박아 넣음 (API 호출 없이 기수/트랙/라벨을 앎)
adm = open('src/admin.html', encoding='utf-8').read().replace('__FORMS_JSON__', json.dumps({'FORMS': ALL_FORMS, 'CURRENT': CUR, 'DEADLINES': DL, 'DEADLINE_KO': DLKO}, ensure_ascii=False))   # 관리 화면은 개선판 폼도 앎
assert '__FORMS_JSON__' not in adm
# 친구 할인 판정 함수 (서버와 같은 것): shared/friend-discount.mjs 에서 주석과 export 만 떼고 그대로 끼움
FRIEND_FN = re.sub(r'^export ', '', re.sub(r'^//.*\n', '', open('shared/friend-discount.mjs', encoding='utf-8').read(), flags=re.M), flags=re.M).strip()
assert FRIEND_FN.startswith('function friendFee(') and adm.count('/*FRIEND_FN*/') == 1
adm = adm.replace('/*FRIEND_FN*/', FRIEND_FN)
os.makedirs('public/admin', exist_ok=True); open('public/admin/index.html', 'w', encoding='utf-8').write(adm); print('built admin', len(adm))
EOF
cp src/early-offer.js public/early-offer.js
# 전남대 축제 이벤트 폼 (/jnu-festival/). 지역 선택(/)에는 안 걸고 링크로만 보냄. 마감 시각은 shared/jnu-festival.mjs 한 곳에서 읽음
FEST_DIR="jnu-festival"; FEE_FEST="4,900"; FEE_FEST_ORIG="12,900"; PAY_FEST="https://haruharu-pay.pages.dev/f/"   # 축제 전용 셀(haruharu-pay /f/). /e/ 를 닫아도 영향 없음
FEST_DEADLINE_KO="10월 2일(금)"
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
echo "done. 배포는 main push (CI). 비상시: npx wrangler pages deploy public --project-name haruharu-apply"

# 개선판 폼 (등록부의 variant: 'v2'). 기존 폼과 따로, 새 주소에만 씀
MIXPANEL_TOKEN="$MP" ./build-v2.sh
