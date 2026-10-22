// 친구 할인 (2026-10-08~): 정가 폼에서 친구와 서로 번호를 적고 신청하면 둘 다 2,000원 할인.
// 판정은 이 함수 한 곳. 서버(제출 때 friend_fee 기록)와 테스트는 import 하고,
// 관리 화면에는 build.sh 가 이 함수 글자를 그대로 끼워 넣음. 그래서 옛 브라우저에서도 도는 문법으로만 씀.
// 폼 화면(src/friend-discount.html)은 친구 선택지를 고르는 순간 할인 금액을 보여 주고, 번호 조건은 폼의 제출 검사가 같은 식으로 받아 둠.
// 대상 폼은 등록부(shared/forms.mjs)에 friendFee(할인된 금액)와 friendPay(그 금액의 송금 페이지)가 있는 폼.
// 돌려주는 값: 이 신청자가 안내받은 친구 할인 금액(원). 할인 대상이 아니면 0.
export function friendFee(form, fields) {
  if (!form || !(form.friendFee > 0) || !fields) return 0;
  var room = String(fields.buddy_room || '');
  if (!room || room === '혼자') return 0;
  var digits = function (v) { return String(v || '').replace(/\D/g, ''); };
  var buddy = digits(fields.buddy), me = digits(fields.phone);
  if (!/^01[016789]\d{7,8}$/.test(buddy) || buddy === me) return 0;   // 친구 번호가 휴대폰 번호 꼴이고 내 번호와 달라야 함
  return feeFor(form, fields.gender).friendFee;
}

// 성별별 금액과 송금 경로. 성별 변경 시 화면과 서버가 같은 등록부를 따른다.
export function feeFor(form, gender) {
  var male = gender === '남성' || gender === 'm';
  return {
    fee: male && form.maleFee ? form.maleFee : form.fee,
    pay: male && form.malePay ? form.malePay : form.pay,
    friendFee: male && form.maleFriendFee ? form.maleFriendFee : form.friendFee,
    friendPay: male && form.maleFriendPay ? form.maleFriendPay : form.friendPay
  };
}
