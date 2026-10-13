#!/bin/zsh
# 개선판 빌드 (10/8~): 등록부(shared/forms.mjs)에서 variant 가 'v2' 인 폼만 src/form.v2.template.html + src/landing.v2.html → public/{경로}/index.html
# 기존 폼, 지역 선택, 관리 화면, 축제 폼은 build.sh 가 만들고 맨 끝에서 이 파일을 부름. 여기서는 그 파일들을 건드리지 않음
# 기수/금액/일정/마감은 전부 shared/forms.mjs 한 곳. 여기엔 문구 조각과 화면 조립만.
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
TPL=open('src/form.v2.template.html',encoding='utf-8').read()
CARD=open('src/info-card.html',encoding='utf-8').read()
EARLY_CARD=open('src/early-info.html',encoding='utf-8').read()
LANDING=open('src/landing.v2.html',encoding='utf-8').read()
LANDING_V3=open('src/landing.v3.html',encoding='utf-8').read()   # 랜딩 3판 (10/12): 등록부 landingV3 폼만
DONE_SURVEY=open('src/done-survey.html',encoding='utf-8').read()
# 자정 마감 할인 (10/13): 짧은 소개 + 남은 시간. 문항/버튼 모양은 랜딩 3판의 style 을 그대로 가져다 씀 (모양을 한 곳에서만 고치게)
COMEBACK=re.sub(r'^<!--.*?-->\n', '', open('src/landing.comeback.html',encoding='utf-8').read(), count=1, flags=re.S)
V3_STYLE=re.search(r'<style>.*?</style>\n', LANDING_V3, flags=re.S).group(0)
# 친구 할인 조각(src/friend-discount.html)과 판정 함수(shared/friend-discount.mjs, export 만 떼고 관리 화면에 그대로 끼움)
_fr=open('src/friend-discount.html',encoding='utf-8').read()
FR_HOOK, _fr = _fr.split('<!--HOOK-->\n',1)[1].split('<!--BANNER-->\n',1)
FR_BANNER, FR_TAIL = _fr.split('<!--TAIL-->\n',1)
REJOIN_HOOK=open('src/rejoin-friend.html',encoding='utf-8').read()
REJOIN_SHARE=re.sub(r'^<!--.*?-->\n', '', open('src/rejoin-share.html',encoding='utf-8').read(), count=1, flags=re.S)
FRIEND_FN=re.sub(r'^export ', '', re.sub(r'^//.*\n', '', open('shared/friend-discount.mjs',encoding='utf-8').read(), flags=re.M), flags=re.M).strip()
assert FRIEND_FN.startswith('function friendFee(')
# 완료 화면의 앱 설치 안내 (src/app-install.html, 맨 위 주석은 빼고 끼움)
APP_GET=re.sub(r'^<!--.*?-->\n', '', open('src/app-install.html',encoding='utf-8').read(), count=1, flags=re.S)
assert APP_GET.startswith('<div class="ap-get">') and APP_GET.count('class="ap-btn"') == 2
BAD='·「」①②③④⑤'
# 랜딩 3판(twoPage) 2페이지의 접힌 친구 문항 펼치기 (모양은 landing.v3.html 의 .fr-mini .fr-toggle .fr-more)
FOLD_TAIL = """<script>
(function(){ var b=document.querySelector('.fr-toggle'), m=document.querySelector('.fr-more'); if(!b||!m) return;
 b.addEventListener('click',function(){ m.hidden=false; b.hidden=true; b.setAttribute('aria-expanded','true');
  try{ if(window.mixpanel&&mixpanel.track) mixpanel.track('friend_toggle_open',{path:location.pathname}); }catch(e){} });
 setTimeout(function(){ var r=document.querySelector('input[name="buddy_room"]:checked'); if(r){ m.hidden=false; b.hidden=true; } },800);   // 저장해 둔 입력을 되살렸으면 펼친 채로
 document.addEventListener('change',function(e){ if(e.target&&e.target.name==='buddy_room'&&m.hidden){ m.hidden=false; b.hidden=true; } });   // 접힌 채로 친구 선택지가 골라지면(키보드 a~e 단축키, 복원) 펼침. 안 그러면 친구 번호 칸이 안 보인 채 검사에 걸림
})();
(function(){ var c=document.getElementById('acctCopy'); if(!c) return; var s=c.querySelector('span'), t0=s.textContent, n=c.getAttribute('data-acct');
 function done(){ s.textContent='계좌번호를 복사했어요'; setTimeout(function(){ s.textContent=t0; },2000); try{ if(window.mixpanel&&mixpanel.track) mixpanel.track('account_copy',{path:location.pathname}); }catch(e){} try{ document.dispatchEvent(new Event('hh-pay')); }catch(e){} }
 function old(){ var ok=false; try{ var ta=document.createElement('textarea'); ta.value=n; ta.setAttribute('readonly',''); ta.style.cssText='position:fixed;left:0;top:0;opacity:0;font-size:16px'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0,n.length); ok=document.execCommand('copy'); document.body.removeChild(ta); }catch(e){} if(ok) done(); else s.textContent=n; }
 c.addEventListener('click',function(){ if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(n).then(done,old); else old(); });
})();
</script>
"""


def NEWGEN(c): return str(c).isdigit() and int(c) >= 4   # 4기부터 쓰는 화면(실적 220명판 P1, 완료 설문). 5기 이후도 같음
def ms(iso): return str(int(datetime.fromisoformat(iso).timestamp()*1000))

def next_path(f):
    if f['cohort']==CUR: return None
    for p,g in FORMS.items():
        if g['cohort']==CUR and g.get('track')==f.get('track') and g['plan']=='regular' and not g.get('variant'): return p
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
    phone_only = bool(f.get('phoneOnly'))   # 5기 재참여: 전화번호만 받음 (지난 신청 정보는 서버가 가져옴)
    one_page = bool(f.get('onePage'))       # 자정 마감 할인: 문항은 그대로 두고 페이지만 안 나눔 (10/13 운영자)
    lastp = '1' if (phone_only or one_page) else ('2' if f.get('twoPage') else '3')      # 참가비 페이지 번호 (전화번호만 받는 폼은 한 페이지, 랜딩 3판은 2페이지)
    fee = f"{f['fee']:,}"
    info = dict(INFO.get(cohort, {}), **({'period': f['period']} if f.get('period') else {}))   # 트랙별 일정이 따로 있으면 그걸로 (직장인 10월 중순)
    target_ko = f['cityKo'] + (' 직장인' if work else ' 대학생')
    region = '수도권' if f['city'] == 'seoul' else f['cityKo']   # 랜딩 표기: 서울 트랙은 수도권 (10/7)
    comeback = bool(f.get('comeback'))   # 자정 마감 할인: 폼 자체 마감(deadline)이 기수 마감보다 이름
    deadline_iso = None if f.get('noDeadline') else (f.get('deadline') or DL.get(cohort)); deadline_ms = ms(deadline_iso) if deadline_iso else '9e15'
    deadline_ko = f.get('deadlineKo') or DLKO.get(cohort, '')
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
        fee_note = (f'{deadline_ko}까지 신청하면 참가비는 {fee}원이에요. 송금까지 마쳐야 신청이 완료돼요.' if comeback
                    else f'친구 초대 할인으로 참가비는 {fee}원이에요. 송금까지 마쳐야 신청이 완료돼요.' if f.get('invite')
                    else f'재참여 할인으로 참가비는 {fee}원이에요. 초대받은 친구도 같은 금액이에요. 송금까지 마쳐야 신청이 완료돼요.' if f.get('rejoin') and cohort != '4'
                    else f'재참여하시는 분과 초대받은 친구 모두 참가비는 {fee}원이에요. 송금까지 마쳐야 신청이 완료돼요.' if f.get('rejoin')
                    else f'사전 알림을 신청해 주신 분은 {fee}원에 참여할 수 있어요. 송금까지 마쳐야 신청이 완료돼요.' if plan in ('early','discount')
                    else f'참가비는 {fee}원이에요. 송금까지 마쳐야 신청이 완료돼요.')
        flow = '1. 이 폼을 작성하고 참가비를 송금한 뒤 제출해요.\n2. 방이 열리면 초대 코드를 문자로 보내드려요.\n3. 앱에 코드를 넣으면 시작이에요.'
        done_title, done_body = '신청이 접수됐어요 💌', '방이 열리면 초대 코드를 문자로 보내드려요.'
        consent = ('성별, 출생연도, 전화번호, 하시는 일, 신청자 확인용 이름, 함께 신청한 친구의 전화번호' if work
                   else '성별, 출생년도, 전화번호, 학교, 신청자 확인용 이름, 함께 신청한 친구의 전화번호')
        if phone_only: consent = '전화번호, 신청자 확인용 이름, 함께 신청한 친구의 전화번호'
    nxt = next_path(f)
    next_link = (f'<p style="margin-top:14px"><a class="btn" href="{nxt}?src=h{CUR}-{f.get("track","")}-from{cohort}" style="display:inline-flex">{CUR}기 신청하러 가기 →</a></p>' if nxt else '')
    p1 = f'P1_{f["city"]}_work_4gi.png' if work else (f'P1_{f["city"]}_4gi.png' if NEWGEN(cohort) else f'P1_{f["city"]}_3gi.png')   # 4기부터 실적 220명/매칭률 34% 판(10/6). 3기 이미지는 그대로
    # 랜딩 v2(10/8) 조각: 첫 화면 안내 칸(진행 일정/참여 대상/그룹 구성), 신청 안내의 칸(마감/참가비, 일정 문구와 같은 값)과 단계(참여 흐름과 같은 문장)
    area = '서울 경기 인천' if f['city'] == 'seoul' else f['cityKo']   # 서울 트랙은 지역을 풀어서 적음 (10/8 사용자)
    ld_info = [('진행 일정', info.get('period', '추후 안내') + (' 예정' if prealert else '')),
               ('참여 대상', f'{area} 직장인' if work else f'{area} 00~07년생 대학생'),
               # 일찍 신청하게 하려는 안내(10/8 사용자). 받은 문장 "신청자가 많을 경우 신청 순서와 그룹 적합도를 함께 고려해 그룹을 구성"을 성비 줄 + 순서 줄로 풀어 씀. 신청을 받는 폼에만
               ('그룹 구성', '남녀 성비 맞춰 3:3 ~ 5:5' + ('' if prealert else '<small>신청이 많으면 <b>먼저 신청한 순서대로</b> 구성해요</small>'))]
    if prealert:
        ld_rows, ld_notes = [], ['사전 알림 신청자에게 먼저 안내 문자를 보내드려요.', '사전 알림 신청자는 참가비 할인 혜택이 있어요.']
    else:
        # 1페이지에는 참가비를 드러내지 않음(10/8 사용자: 1페이지 이탈과 2페이지 이탈을 견줘 참가비가 적절한지 보려고). 금액, 송금, 환불 문구는 2페이지 참가비 안내에서 처음 나옴
        ld_rows = [('신청 마감', deadline_ko), ('참가 안내', '신청 마감일까지 참가 확정 문자를&nbsp;보내드려요')]
        if f.get('feeFirst'):   # 10/11 사용자: 참가비는 첫 화면 말고 신청 안내에만 (12,900 → 7,900), 그 바로 아래 다음 기수 알림. 결제 페이지에서 금액을 처음 보고 나가는 이탈 때문에 10/8 숨김 결정을 바꿈
            ld_rows.insert(1, ('참가비', (f"<s>{f['listFee']:,}원</s> → " if f.get('listFee') else '') + f"{f['fee']:,}원" + (f"<small>친구랑 같이 신청하면 둘 다 <b>{f['friendFee']:,}원</b></small>" if f.get('friendFee') else '')))   # 10/8 사용자: 마감일 밤이 아니라 마감일까지. 더 일찍 보낼 수도 있다는 말은 넣지 않기로 함
        ld_notes = []
    ld_cells = lambda rows: ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in rows)
    ld_flow = flow if (prealert or f.get('landingV3')) else flow.replace('참가비를 송금한 뒤 ', '')   # 랜딩의 단계 문구도 참가비 없이 (위와 같은 까닭). 랜딩 3판은 송금을 다시 넣음 (10/12)
    ld_steps = ''.join('<li>' + re.sub(r'^\d+\.\s*', '', s) + '</li>' for s in ld_flow.split('\n'))
    if f.get('landingV3'): ld_steps = ld_steps.replace('참가비를 송금한 뒤', f'참가비 <b>{fee}원</b>을 송금한 뒤')
    # 랜딩 3판 안내 카드 다섯 줄 + 첫 화면 칩 (짧은 날짜)
    short = lambda x: re.sub(r'(\d+)월 (\d+)일\((.)\)', r'\1/\2(\3)', x).replace(', 3일', '')
    rows_a = [('참여 대상', f'{area} 00~07년생 대학생'), ('진행 기간', info.get('period', '추후 안내')), ('신청 마감', deadline_ko + '<small>참가 확정 문자는 마감일까지 보내드려요</small>'),
              ('참가비', f'{fee}원<small>인원이 안 맞아 방이 안 열리면 <b>전액 환불</b></small>'), ('그룹 구성', '남녀 성비 맞춰 3:3 ~ 5:5<small>신청이 많으면 <b>먼저 신청한 순서대로</b> 구성해요</small>')]
    if comeback:
        confirm_by = re.sub(r'\s*\d+:\d+$', '', DLKO.get(cohort, ''))   # 참가 확정 문자는 기수 마감일까지
        rows_a = [('참여 대상', f'{area} 00~07년생 대학생'), ('진행 기간', info.get('period', '추후 안내') + f'<small>참가 확정 문자는 {confirm_by}까지 보내드려요</small>'),
                  ('참가비', f"<s>{f['wasFee']:,}원</s> → {fee}원<small>인원이 안 맞아 방이 안 열리면 <b>전액 환불</b></small>"), ('그룹 구성', '남녀 성비 맞춰 3:3 ~ 5:5')]
        reg = next((p for p, g in FORMS.items() if g['cohort'] == cohort and g.get('track') == f.get('track') and g['plan'] == 'regular' and g.get('entry')), None)
        assert reg, f'{path} 할인이 끝난 뒤 안내할 정가 폼이 없음'
        next_link = f'<p style="margin-top:14px"><a class="btn" href="{reg}?src=h{cohort}-{f.get("track","")}-comeback-closed" style="display:inline-flex">{cohort}기 신청하러 가기 →</a></p>'
    t = TPL
    if comeback:
        # 마감 안내: 기수가 아니라 이 할인만 끝난 것. 기수 신청은 정가 폼에서 계속 받음. 링크 미리보기 제목도 메시지에 맞춤
        c0 = '<h2>신청이 마감됐어요</h2><p>하루하루 소개팅 __COHORT__기 신청은 __DEADLINE_KO__에 마감됐어요.<br>'
        og = '<meta property="og:title" content="하루하루 소개팅 __COHORT__기 신청폼 💕">'
        assert t.count(c0) == 1 and t.count(og) == 1, f'{path} 마감 안내/미리보기 제목 자리를 못 찾음'
        t = t.replace(c0, f'<h2>{fee}원 할인이 끝났어요</h2><p>__DEADLINE_KO__까지였던 할인 신청이 마감됐어요.<br>__COHORT__기 신청은 {DLKO.get(cohort, "")}까지 받고 있어요.<br>', 1)
        t = t.replace(og, f'<meta property="og:title" content="아직 고민 중이라면? 오늘 자정까지 {fee}원">', 1)
    # 랜딩판(10/7 Figma F1): 옛 머리말 + P1~P4 + 소개 문단 자리를 통째로 교체
    if f.get('landing'):
        t = re.sub(r'<!--TOP_START-->.*?<!--TOP_END-->', lambda m: (V3_STYLE + COMEBACK if comeback else LANDING_V3 if f.get('landingV3') else LANDING), t, flags=re.S)
        # 랜딩 v2: 참여 흐름/정보 안내/문의 글자 블록은 랜딩의 신청 안내 + 신청서 머리말이 대신함
        t = re.sub(r'<!--INFO_START-->.*?<!--INFO_END-->\n', '', t, flags=re.S)
    else:
        t = t.replace('<!--TOP_START-->\n', '').replace('<!--TOP_END-->\n', '').replace('<!--INFO_START-->\n', '').replace('<!--INFO_END-->\n', '')
    for k, v in {
        '__LD_BADGE__': f"{cohort}기 " + ('사전 알림' if prealert else '모집 중'), '__LD_WHO__': f"{region} {'직장인' if work else '대학생'}",
        '__LD_INFO__': ld_cells(ld_info), '__LD_ROWS__': ld_cells(ld_rows), '__LD_STEPS__': ld_steps,
        '__LD_NOTES__': ''.join(f'<p>{n}</p>' for n in ld_notes),
        '__LD_ROWS_A__': ld_cells(rows_a), '__LD_PERIOD__': short(info.get('period', '추후 안내')), '__LD_DEADLINE__': short(deadline_ko), '__LD_FEE__': fee,
        '__LD_CITY_KO__': f['cityKo'], '__LD_LIFE__': ('adgrid' if f['city'] == 'seoul' else 'feed'),   # 랜딩 3판: 헤드/눈썹 지역, 일상 사진은 서울만 집행 광고 그리드(칸에 서울 글자), 광주는 앱 화면
        '__CITY__': f['city'], '__CITY_KO__': f['cityKo'], '__TARGET_KO__': target_ko, '__TARGET_SHORT__': ('직장인' if work else '대학생'),
        '__TRACK__': f.get('track',''),
        '__LD_CTA__': ('사전 알림 신청하기 💌' if prealert else '소개팅 신청하기 💌'), '__LD_WAS__': f"{f.get('wasFee', 0):,}",
        '__IMG_P1__': p1, '__SCHEDULE__': sched, '__COHORT__': cohort, '__PLAN__': plan,
        '__FEE_NOTE__': fee_note, '__PAY_URL__': f.get('pay') or '#', '__FEE__': fee, '__MP__': MP,
        '__DEADLINE_MS__': deadline_ms, '__DEADLINE_KO__': deadline_ko, '__NEXT_LINK__': next_link, '__FLOW__': flow,
        '__SCHOOL_Q__': '' if phone_only else school_q(f), '__SOURCE_D__': ('블라인드' if work else '에브리타임'), '__EXTRA_Q__': extra_q(f),
        '__DONE_SURVEY__': (DONE_SURVEY if NEWGEN(cohort) else ''),   # 4기 폼 전부 완료 화면 선택 문항 (10/7)
        '__CONSENT_ITEMS__': consent, '__DONE_TITLE__': done_title, '__DONE_BODY__': done_body,
        '__ALERT_PATH__': f.get('alert', ''),
        '__LD_ALERT__': ('<div class="ld-al"><button type="button" class="ld-al-open" id="ldAlOpen">지금은 말고, 다음 기수 알림만 받을래요</button>'
                         '<div class="ld-al-box" id="ldAlBox" hidden><p class="ld-al-t">다음 기수, 가장 먼저 알려드릴게요</p><p class="ld-al-s">모집이 열리면 문자 한 통만 보내요.</p>'
                         '<div class="ld-al-g"><button type="button" data-g="여성">여성</button><button type="button" data-g="남성">남성</button></div>'
                         '<input type="text" id="ldAlBirth" inputmode="numeric" placeholder="출생년도 (2003)" maxlength="4">'
                         '<input type="tel" id="ldAlPhone" inputmode="numeric" placeholder="전화번호 (01012345678)" maxlength="13" autocomplete="tel" class="mp-sensitive">'
                         '<label class="ld-al-c"><input type="checkbox" id="ldAlAgree">모집 알림 문자를 보내기 위해 성별, 출생년도, 전화번호를 받아요. 알림을 보낸 뒤 6개월이 지나면 지워요.</label>'
                         '<button type="button" class="ld-al-go" id="ldAlGo" disabled>알림 받기</button></div>'
                         '<p class="ld-al-done" id="ldAlDone" hidden>알림 신청이 끝났어요 🙌<span>모집이 열리면 문자로 먼저 알려드릴게요.</span></p></div>\n' if f.get('alert') else ''),
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
    if f.get('rejoin'):
        # 재참여는 유입 경로와 신청 마음을 다시 묻지 않음. URL의 src/utm 추적은 유지.
        for question in ('source', 'intent') + (('gender', 'birth_year', 'device') if phone_only else ()):
            t, removed = re.subn(r'<div class="q" data-name="' + question + r'">.*?</div>\n\n', '', t, count=1, flags=re.S)
            assert removed == 1, f'{path} 재참여에서 뺄 문항을 못 찾음: {question}'
    if phone_only:
        # 랜딩의 신청 버튼과 여백 기준을 첫 문항(전화번호)으로
        assert t.count('.q[data-name="gender"]') == 2, f'{path} 랜딩 신청 버튼 기준을 못 찾음'
        t = t.replace('.q[data-name="gender"]', '.q[data-name="phone"]')
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
    if f.get('landing'):   # 랜딩의 측정/이동 고리 (아래 고정 버튼, LandingEngaged 기준 요소) + 성별 판 사진
        for need in (('id="cbClock"', 'id="cbBar"', 'data-cta="hero"') if comeback else ('data-cta="sticky"', 'data-engage')):
            assert need in t, f'{path} 랜딩 필수 요소 없음: {need}'
        if not prealert and f.get('twoPage'):   # 랜딩 3판(10/12): 템플릿의 2페이지(전화, 동의, 참가비) 그대로. 동의 전엔 임시 저장에 연락처를 안 넣는 것은 3페이지판과 같게
            pf = "function partial(beacon){ if(submitted) return; post('/partial',{sid:sid,path:location.pathname,page:curPage,last_field:lastField,fields:data(),"
            assert t.count(pf) == 1, f'{path} 임시 저장 함수를 못 찾음'
            t = t.replace(pf, "function partial(beacon){ if(submitted) return; var pfields=data(); if(!pfields.consent){ delete pfields.phone; delete pfields.name; delete pfields.buddy; }\n  post('/partial',{sid:sid,path:location.pathname,page:curPage,last_field:lastField,fields:pfields,")
            assert 'data-page="3"' not in t and t.count('<div class="q" data-name="phone">') == 1, f'{path} 랜딩 3판은 2페이지여야 함'
        if not prealert and not f.get('twoPage'):
            # 전화번호와 개인정보 동의 문항만 따로 2페이지로 떼고, 원래 2페이지(친구 문항, 참가비 안내)는 3페이지로 (10/8 사용자: 어디서 나가는지 자세히 보려고).
            #   1페이지 이탈 = 기본 문항, 2페이지 이탈 = 연락처와 동의, 3페이지 이탈 = 참가비 반응. 템플릿 스크립트는 페이지 수와 버튼의 data-next/data-prev 를 읽어서 움직임
            m = re.search(r'<div class="q" data-name="phone">.*?<div class="q" data-name="consent">.*?</div>\n\n', t, flags=re.S)
            sec2 = '<section class="page" data-page="2">\n'; prev1 = '<button type="button" class="btn sec2" data-prev="1">← 이전</button>'
            nav3 = prev1 + '<button type="submit" class="btn" id="submit">제출하기</button>'
            nav1 = '<div class="nav"><button type="button" class="btn" data-next="2">다음 페이지 →</button></div>\n'
            assert m and t.count(sec2) == 1 and t.count(nav3) == 1 and t.index(sec2) + len(sec2) == m.start(), f'{path} 전화번호/동의 문항 또는 2페이지 자리를 못 찾음'
            if phone_only:
                # 한 페이지에 전부 (10/11 운영자: 다음 페이지 없이 한번에). 전화번호, 친구 문항, 참가비, 제출 버튼 순서, 그 아래 친구 추천 칸
                join = nav1 + '</section>\n\n' + sec2
                assert t.count(join) == 1, f'{path} 1페이지 다음 버튼을 못 찾음'
                # 동의 체크 문항은 두지 않고(10/11 운영자), 전화번호 아래에 이용 안내 한 줄만. 지난 신청 정보를 다시 쓴다는 것도 여기서 밝힘
                mc = re.search(r'<div class="q" data-name="consent">.*?</div>\n\n', m.group(0), flags=re.S)
                assert mc, f'{path} 동의 문항을 못 찾음'
                notice = '<p class="rj-privacy">신청 확인, 방 배정, 초대 코드와 일정 안내를 위해 전화번호와 이름, 지난 신청 때 적어 주신 성별, 출생년도, 학교를 이용해요. 기수 종료 6개월 뒤 파기합니다.</p>\n\n'
                t = t.replace(join + m.group(0), m.group(0).replace(mc.group(0), notice), 1)
                t = t.replace('<div class="nav">' + nav3 + '</div>\n', '<div class="nav"><button type="submit" class="btn" id="submit">제출하기</button></div>\n', 1)
            elif one_page:
                # 한 페이지에 전부: 1페이지 다음 버튼과 2페이지 경계만 없애고 문항 순서는 그대로 (기본 문항, 전화번호, 동의, 참가비, 친구, 제출)
                join = nav1 + '</section>\n\n' + sec2
                assert t.count(join) == 1, f'{path} 1페이지 다음 버튼을 못 찾음'
                t = t.replace(join, '', 1)
                t = t.replace('<div class="nav">' + nav3 + '</div>\n', '<div class="nav"><button type="submit" class="btn" id="submit">제출하기</button></div>\n', 1)
            else:
                nav2 = '<div class="nav">' + prev1 + '<button type="button" class="btn" data-next="3">다음 페이지 →</button></div>\n'
                t = t.replace(nav3, nav3.replace('data-prev="1"', 'data-prev="2"'), 1)
                t = t.replace(sec2 + m.group(0), sec2 + m.group(0).rstrip('\n') + '\n\n' + nav2 + '</section>\n\n<section class="page" data-page="3">\n', 1)
            # 동의에 체크하기 전에 적은 전화번호가 임시 저장(/partial)으로 나가지 않게, 동의 전에는 연락처를 빼고 보냄
            pf = "function partial(beacon){ if(submitted) return; post('/partial',{sid:sid,path:location.pathname,page:curPage,last_field:lastField,fields:data(),"
            assert t.count(pf) == 1, f'{path} 임시 저장 함수를 못 찾음'
            t = t.replace(pf, "function partial(beacon){ if(submitted) return; var pfields=data(); if(!pfields.consent){ delete pfields.phone; delete pfields.name; delete pfields.buddy; }\n  post('/partial',{sid:sid,path:location.pathname,page:curPage,last_field:lastField,fields:pfields,")
            qp, qc = '<div class="q" data-name="phone">', '<div class="q" data-name="consent">'   # 문항 블록으로 찾음 (랜딩의 스타일 선택자에도 data-name 이 나와서)
            if phone_only:
                p1 = t.split('data-page="1"', 1)[1].split('data-page="done"', 1)[0]
                assert 'data-page="2"' not in t and 'data-next=' not in t and 'data-prev=' not in t and t.count('id="submit"') == 1, f'{path} 한 페이지 구성이 어긋남'
                assert qc not in t and 'class="rj-privacy"' in p1 and p1.index(qp) < p1.index('<div class="q" data-name="name">') < p1.index('id="submit"'), f'{path} 문항 순서가 다름'
            elif one_page:
                p1 = t.split('data-page="1"', 1)[1].split('<section class="page" data-page="done">', 1)[0]
                assert 'data-page="2"' not in t and 'data-next=' not in t and 'data-prev=' not in t and t.count('id="submit"') == 1, f'{path} 한 페이지 구성이 어긋남'
                assert p1.index('<div class="q" data-name="gender">') < p1.index(qp) < p1.index(qc) < p1.index('<div class="q" data-name="name">') < p1.index('id="submit"'), f'{path} 문항 순서가 다름'
            else:
                p1, rest = t.split('data-page="1"', 1)[1].split('data-page="2"', 1)
                p2, p3 = rest.split('data-page="3"', 1); p3 = p3.split('data-page="done"', 1)[0]
                assert qp in p2 and qc in p2 and p2.count('<div class="q"') == 2 and qp not in p1 + p3 and qc not in p1 + p3, f'{path} 전화번호/동의 문항 위치가 다름'
                assert 'data-next="2"' in p1 and 'data-prev="1"' in p2 and 'data-next="3"' in p2 and 'data-prev="2"' in p3 and 'id="submit"' in p3 and '<div class="q" data-name="name">' in p3, f'{path} 페이지 이동 버튼이 어긋남'
        if f.get('friendFee') or f.get('rejoin'):
            # 친구 할인 (10/8): 친구 문항을 참가비 안내 위로 올리고, 제목을 할인 안내로 바꾸고, 친구 선택지를 고르면 금액과 송금 버튼이 할인 금액으로 바뀜. 친구 문항에는 공유 버튼
            won = lambda n: f'{n:,}'
            share_only = bool(f.get('rejoin'))
            off = won(f['fee'] - f.get('friendFee', f['fee']))
            frv = {'__FR_OFF__': off, '__FULL_FEE__': won(f['fee']), '__FRIEND_FEE__': won(f.get('friendFee', f['fee'])),
                   '__PAY__': f['pay'], '__FRIEND_PAY__': f.get('friendPay', f['pay']), '__FR_LIST__': ('<s>' + won(f['listFee']) + '원</s> → ') if f.get('listFee') else '',
                   '__SHARE_ONLY__': 'true' if share_only else 'false', '__SHARE_PATH__': ("'" + f['friendForm'] + "'") if f.get('friendForm') else 'location.pathname', '__SHARE_SRC__': f'h{cohort}-friend' + ('-rejoin' if share_only else ''),
                   '__SHARE_TEXT__': (f'하루하루 소개팅 해 봐! 이 링크로 신청하면 {fee}원에 할인받을 수 있어.' if f.get('friendForm')
                                      else f'하루하루 소개팅 같이 신청하자! 이 링크로 신청하면 친구도 {fee}원이야. 신청서 친구 번호 칸에 서로 번호를 적어줘.' if share_only
                                      else f'하루하루 소개팅 같이 신청하자! 신청서 친구 번호 칸에 서로 번호를 적으면 둘 다 {off}원 할인이래.')}
            def frfill(s):
                for k, v in frv.items(): s = s.replace(k, v)
                return s
            mb = re.search(r'<div class="q" data-name="buddy_room">.*?<p class="err">친구 전화번호를 확인해 주세요</p></div>\n*', t, flags=re.S)
            name_open = '<div class="q" data-name="name">'; title = '<p class="t">친구랑 함께 신청하셨나요?</p>\n'; note = '친구도 신청서에 내 번호를 적어야 반영돼요.'
            assert mb and t.count(name_open) == 1 and mb.group(0).count(title) == 1 and mb.group(0).count(note) == 1, f'{path} 친구 문항/참가비 안내를 못 찾음'
            hook = REJOIN_SHARE if phone_only else REJOIN_HOOK if share_only else FR_HOOK   # 전화번호만 받는 폼은 친구 추천과 방 배정을 한 문항으로
            buddy = mb.group(0).rstrip('\n').replace(title, frfill(hook), 1)
            if not share_only: buddy = buddy.replace(note, '친구도 신청서에 내 번호를 적어야 방 배정과 할인에 반영돼요.', 1)
            t = t.replace(mb.group(0), '', 1).replace(name_open, buddy + '\n\n' + name_open, 1)
            if not share_only:
                a0 = t.index(name_open); a1 = t.index('<p class="err">송금자 이름을 입력해 주세요</p></div>', a0)
                blk = t[a0:a1]; ftitle = '<p class="t">참가비 안내<span class="req">*</span></p>\n'; amt = won(f['fee']) + '원'
                assert blk.count(amt) == 3 and blk.count(ftitle) == 1 and blk.count('href="' + f['pay'] + '"') == 1, f'{path} 참가비 안내의 금액 자리가 예상과 다름'
                blk = blk.replace(amt, '<span class="fr-fee">' + won(f['fee']) + '</span>원').replace(ftitle, ftitle + frfill(FR_BANNER), 1)
                t = t[:a0] + blk + t[a1:]
            if (f.get('twoPage') or f.get('phonePage')) and not share_only:   # phonePage(10/13): 3페이지판에서도 친구 문항을 이름 아래로 접음
                # 랜딩 3판(10/12): 친구 문항을 송금자 이름 아래로 내리고 한 줄 + 버튼으로 접음 (5기 3페이지 미제출 32명 중 16명이 친구 문항에서 멈춤). 아무것도 안 고르면 혼자(정가)
                mb2 = re.search(r'<div class="q" data-name="buddy_room">.*?<p class="err">친구 전화번호를 확인해 주세요</p></div>\n*', t, flags=re.S)
                bd = mb2.group(0).rstrip('\n'); hk = frfill(FR_HOOK); sh = re.search(r'<button type="button" class="fr-share">.*?</button>', hk, flags=re.S)
                o0 = bd.index('<div class="opts">'); o1 = bd.index('<p class="err">친구 전화번호를 확인해 주세요</p>')
                assert sh and bd.count(hk) == 1 and o0 < o1, f'{path} 랜딩 3판 친구 문항을 못 접음'
                mini = (f'<div class="fr-mini"><p>친구랑 같이 신청하면<br><b>둘 다 {won(f["friendFee"])}원</b></p>'
                        '<button type="button" class="fr-toggle" aria-expanded="false">친구랑 신청해요</button></div>')
                bd2 = bd[:o0].replace(hk, mini, 1) + '<div class="fr-more" hidden>\n ' + bd[o0:o1].rstrip() + '\n ' + sh.group(0) + '</div>\n ' + bd[o1:]
                name_end = '<p class="err">송금자 이름을 입력해 주세요</p></div>'
                assert t.count(name_end) == 1, f'{path} 송금자 이름 칸을 못 찾음'
                t = t.replace(mb2.group(0), '', 1).replace(name_end, name_end + '\n\n' + bd2 + '\n', 1)
            foot = '<p class="foot">'; assert t.count(foot) == 1
            t = t.replace(foot, frfill(FR_TAIL) + foot, 1)
            if f.get('twoPage') or f.get('phonePage'):
                # 계좌번호 복사 버튼 (10/12 사용자: 토스 말고 계좌 복사도). 토스 버튼 바로 아래, 계좌는 템플릿 안내 글자에서 읽음
                ac = re.search(r'입금 계좌 : 토스뱅크 ([\d-]+)', t); pay_a = re.search(r'<a class="pay" id="pay"[^>]*>.*?</a>\n', t, flags=re.S)
                assert ac and pay_a, f'{path} 계좌/송금 버튼을 못 찾음'
                t = t.replace(pay_a.group(0), pay_a.group(0) + f' <button type="button" class="acct-copy" id="acctCopy" data-acct="{ac.group(1)}"><span>토스뱅크 {ac.group(1)} 계좌번호 복사</span></button>\n', 1)
                t = t.replace(foot, FOLD_TAIL + foot, 1)
            p3 = t.split(f'data-page="{lastp}"', 1)[1].split('data-page="done"', 1)[0]
            if f.get('friendForm'): assert FORMS.get(f['friendForm'], {}).get('fee') == f['fee'] and not FORMS[f['friendForm']].get('phoneOnly'), f'{path} 친구 초대 폼이 없거나 금액이 다름'
            assert ((p3.index('<div class="q" data-name="buddy_room">') > p3.index('<div class="q" data-name="name">')) if (f.get('twoPage') or f.get('phonePage')) else (p3.index('<div class="q" data-name="buddy_room">') < p3.index('<div class="q" data-name="name">'))) and '__FR' not in t and '__SHARE' not in t and t.count('class="fr-share"') == 1 and (not phone_only or 'class="rj-room"' in p3), f'{path} 친구 할인 조각이 제대로 안 들어감'
        if comeback:
            # 계좌번호 복사 버튼 (5기 정가 폼과 같은 것). 친구 할인이 없어 위 블록을 안 타므로 여기서 따로 끼움
            ac = re.search(r'입금 계좌 : 토스뱅크 ([\d-]+)', t); pay_a = re.search(r'<a class="pay" id="pay"[^>]*>.*?</a>\n', t, flags=re.S); foot = '<p class="foot">'
            assert ac and pay_a and t.count(foot) == 1, f'{path} 계좌/송금 버튼을 못 찾음'
            t = t.replace(pay_a.group(0), pay_a.group(0) + f' <button type="button" class="acct-copy" id="acctCopy" data-acct="{ac.group(1)}"><span>토스뱅크 {ac.group(1)} 계좌번호 복사</span></button>\n', 1)
            t = t.replace(foot, FOLD_TAIL + foot, 1)
            ftitle = '<p class="t">참가비 안내<span class="req">*</span></p>\n'
            assert t.count(ftitle) == 1, f'{path} 참가비 안내 제목을 못 찾음'
            t = t.replace(ftitle, ftitle + f' <p class="fee-was"><s>{f["wasFee"]:,}원</s> → <strong>{fee}원</strong></p>\n', 1)
        if f.get('listFee'):
            # 정가 표시 (10/8): 참가비 안내 제목 아래에 정가를 줄 긋고 실제 참가비를 크게. 친구 할인이 켜지면 이 줄은 숨고 친구 할인 안내가 정가부터 이어서 보여 줌
            ftitle = '<p class="t">참가비 안내<span class="req">*</span></p>\n'
            assert t.count(ftitle) == 1, f'{path} 참가비 안내 제목을 못 찾음'
            t = t.replace(ftitle, ftitle + f' <p class="fee-was"><s>{f["listFee"]:,}원</s> → <strong>{fee}원</strong></p>\n', 1)
        if not prealert:
            # 완료 화면: 완료 문구 바로 아래에 앱 설치 안내 (10/8 운영자). 무료 사전 알림 폼은 방이 아직 안 잡혀서 뺌
            d0 = t.index('<section class="page" data-page="done">'); d1 = t.index('</p>', d0) + 4
            t = t[:d1] + '\n' + APP_GET.rstrip('\n') + t[d1:]
        if not prealert and not phone_only:   # 참가비는 3페이지에서 처음 나와야 함 (페이지별 이탈 비교용). 1, 2페이지를 같이 봄. 한 페이지짜리 재참여 폼은 해당 없음
            page1 = t.split('data-page="1"', 1)[1].split(f'data-page="{lastp}"', 1)[0]
            for word in (() if f.get('feeFirst') else ('참가비', '송금', fee + '원') + ((f'{f["listFee"]:,}원',) if f.get('listFee') else ())):   # feeFirst 폼은 첫 화면에 금액을 일부러 보여줌
                assert word not in page1, f'{path} 1, 2페이지에 참가비 관련 말이 있음: {word}'
        for v in ('' if comeback else 'fm'):   # 앱 화면은 링크 성별에 맞춰 스크립트로 주소를 이어 붙임
            assert os.path.exists(f'public/img/L_store_feed_{v}.webp'), f'{path} 앱 화면 이미지 없음: L_store_feed_{v}.webp'
        keys = [] if comeback else re.findall(r"(\w+):'", t.split('var P={', 1)[1].split('};', 1)[0])   # 스크립트 속 참가자 예시 목록(키 = 사진 파일 이름)
        assert comeback or len(keys) >= 6, f'{path} 참가자 예시 목록을 못 읽음: {keys}'
        for k in keys:
            assert os.path.exists(f'public/img/L_p_{k}.webp'), f'{path} 성별 판 프로필 사진 없음: L_p_{k}.webp'
            assert os.path.exists(f'public/img/L_pc_{k}.webp'), f'{path} 성별 판 프로필 사진(선명) 없음: L_pc_{k}.webp'
    bad = [c for c in BAD if c in t.replace('받은 질문 · 1','')]
    assert not bad, f'{path} 금지 문자: {bad}'
    for img in re.findall(r'src="/img/([^"]+)"', t):
        assert os.path.exists('public/img/' + img), f'{path} 이미지 없음: {img}'
    open(outdir + 'index.html', 'w', encoding='utf-8').write(t)
    print('built', path, cohort, plan, fee, len(t))

built = 0
for path, f in FORMS.items():
    if f.get('variant') != 'v2': continue
    gen(path, f); built += 1
assert built, '등록부에 개선판(variant v2) 폼이 없음'
EOF
