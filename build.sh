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
TPL=open('src/form.template.html',encoding='utf-8').read()
CARD=open('src/info-card.html',encoding='utf-8').read()
EARLY_CARD=open('src/early-info.html',encoding='utf-8').read()
BAD='·「」①②③④⑤'

def ms(iso): return str(int(datetime.fromisoformat(iso).timestamp()*1000))

def next_path(f):
    if f['cohort']==CUR: return None
    for p,g in FORMS.items():
        if g['cohort']==CUR and g.get('track')==f.get('track') and g['plan']=='regular': return p
    return '/'

# 트랙별 문구
def school_q(f):
    if f.get('occupation'):
        opts=['회사원','공무원, 공공기관','전문직','자영업, 프리랜서','대학원생, 취업 준비','기타']
        rows=''.join(f'  <label class="opt"><span class="k">{chr(65+i)}</span><input type="radio" name="school" value="{o}"{" required" if i==0 else ""}>{o}</label>\n' for i,o in enumerate(opts))
        return f'<div class="q" data-name="school"><p class="t">하시는 일<span class="req">*</span></p>\n <div class="opts">\n{rows} </div><p class="err">선택해 주세요</p></div>'
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
    info = INFO.get(cohort, {})
    target_ko = f['cityKo'] + (' 직장인' if work else ' 대학생')
    deadline_iso = DL.get(cohort); deadline_ms = ms(deadline_iso) if deadline_iso else '9e15'
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
    p1 = 'P1_seoul_work_4gi.png' if work else f'P1_{f["city"]}_3gi.png'   # 학생 P1 은 기수값 없음(00~07년생, 160명/27쌍) → 재사용
    t = TPL
    for k, v in {
        '__CITY__': f['city'], '__CITY_KO__': f['cityKo'], '__TARGET_KO__': target_ko, '__TARGET_SHORT__': ('직장인' if work else '대학생'),
        '__TRACK__': f.get('track',''), '__IMG_P1__': p1, '__SCHEDULE__': sched, '__COHORT__': cohort, '__PLAN__': plan,
        '__FEE_NOTE__': fee_note, '__PAY_URL__': f.get('pay') or '#', '__FEE__': fee, '__MP__': MP,
        '__DEADLINE_MS__': deadline_ms, '__DEADLINE_KO__': deadline_ko, '__NEXT_LINK__': next_link, '__FLOW__': flow,
        '__SCHOOL_Q__': school_q(f), '__SOURCE_D__': ('블라인드' if work else '에브리타임'), '__EXTRA_Q__': extra_q(f),
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
    if f.get('festival'): continue
    gen(path, f)

# 지역 선택 페이지 (루트): 현재 기수의 listed 폼만 버튼으로
sel = open('src/select.template.html', encoding='utf-8').read()
listed = [(p, f) for p, f in FORMS.items() if f['cohort'] == CUR and f.get('listed')]
btns = '\n'.join(f' <a class="b" href="{p}" data-city="{f["city"]}"><span class="t"><b>{f["cityKo"]} 소개팅 신청</b><span>{f["cityKo"]} {"직장인" if f.get("occupation") else "대학생"} / {f["fee"]:,}원</span></span><span class="ar">→</span></a>' for p, f in listed)
sel = (sel.replace('__MP__', MP).replace('__COHORT__', CUR).replace('__DEADLINE_MS__', ms(DL[CUR])).replace('__DEADLINE_KO__', DLKO[CUR]).replace('__BUTTONS__', btns))
left = re.findall(r'__[A-Z0-9_]+__', sel); assert not left, 'select placeholder 남음: ' + str(left)
open('public/index.html', 'w', encoding='utf-8').write(sel); print('built select', len(sel), [p for p, _ in listed])
# 관리 페이지: 등록부 JSON 을 박아 넣음 (API 호출 없이 기수/트랙/라벨을 앎)
adm = open('src/admin.html', encoding='utf-8').read().replace('__FORMS_JSON__', json.dumps({'FORMS': FORMS, 'CURRENT': CUR, 'DEADLINE_KO': DLKO}, ensure_ascii=False))
assert '__FORMS_JSON__' not in adm
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
