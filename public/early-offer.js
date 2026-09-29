// Only pre-registration pages call this controller. Server time governs the countdown.
window.setupEarlyOffer = function(hidden, onExpire) {
  var banner=document.getElementById('early-banner'), pay=document.getElementById('pay');
  var submit=document.getElementById('submit'), fee=document.getElementById('offer-fee');
  var caption=document.getElementById('offer-caption');
  var offer=null, received=0, ready=false, checking=false, expired=false, redirected=false;
  var clock=document.getElementById('offer-clock'), message=document.getElementById('offer-message');
  var original=document.getElementById('offer-original');
  clock.innerHTML=['시간','분','초'].map(function(label,index){
    return (index?'<span class="flip-colon" aria-hidden="true">:</span>':'')+'<div class="flip-unit" aria-hidden="true"><div class="flip-pair"><div class="flip-digit"></div><div class="flip-digit"></div></div><span class="flip-label">'+label+'</span></div>';
  }).join('');
  var digits=clock.querySelectorAll('.flip-digit');
  function drawClock(seconds){
    var hours=Math.floor(seconds/3600), minutes=Math.floor(seconds/60)%60, secs=seconds%60;
    var value=String(hours).padStart(2,'0')+String(minutes).padStart(2,'0')+String(secs).padStart(2,'0');
    clock.setAttribute('aria-label',hours+'시간 '+minutes+'분 '+secs+'초 남음');
    digits.forEach(function(digit,index){
      var next=value[index], previous=digit.dataset.value;
      if(previous===next) return;
      function half(position,number,extra){return '<span class="flip-half flip-'+position+' '+(extra||'')+'"><span>'+number+'</span></span>';}
      digit.innerHTML=half('top',next)+half('bottom',next)+(previous===undefined?'':half('top',previous,'flip-old')+half('bottom',next,'flip-new'));
      digit.dataset.value=next;
    });
  }
  function locked(value) {
    ready=!value;
    pay.setAttribute('aria-disabled',String(value));
    if(value) pay.removeAttribute('href');
    submit.disabled=value || document.getElementById('f').dataset.submitting==='true';
  }
  locked(true);
  function render() {
    if(!offer) return;
    var now=offer.serverNow+(performance.now()-received);
    var active=!expired && offer.active && now<offer.endsAt;
    if(!active){
      expired=true;
      locked(true);
      clock.hidden=true;
      message.hidden=false;
      message.textContent='사전알림 특가가 종료되어 일반 신청폼으로 이동합니다.';
      if(!redirected && document.getElementById('f').dataset.submitting!=='true'){
        redirected=true;
        onExpire();
      }
      return;
    }
    if(banner.dataset.state!=='active'){
    fee.textContent='4,900원';
    caption.textContent='사전알림 신청자 한정 특가';
    original.hidden=false;
    banner.dataset.state='active';
    }
    clock.hidden=false;
    if(ready) pay.href='https://haruharu-pay.pages.dev/e/';
    message.textContent='';
    message.hidden=true;
    drawClock(Math.max(0,Math.ceil((offer.endsAt-now)/1000)));
  }

  function update(value) {
    if(!value || !Number.isFinite(value.serverNow) || !Number.isFinite(value.endsAt) || typeof value.active!=='boolean') throw new Error('Invalid offer');
    offer=value; received=performance.now(); locked(false); render();
  }
  function refresh() {
    if(checking) return;
    checking=true; locked(true);
    var controller=new AbortController();
    var timeout=setTimeout(function(){controller.abort();},8000);
    fetch('/api/early-offer',{cache:'no-store',signal:controller.signal})
      .then(function(r){if(!r.ok) throw new Error('Offer unavailable'); return r.json();})
      .then(update)
      .catch(function(){locked(true); clock.hidden=true; message.hidden=false; message.textContent='할인 정보를 확인하지 못했어요. 잠시 후 다시 확인할게요. 송금과 제출은 확인 후 진행해 주세요.';})
      .finally(function(){clearTimeout(timeout);checking=false;});
  }
  pay.addEventListener('click',function(e){
    if(offer) render();
    if(!ready || expired) e.preventDefault();
  });
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible') refresh();});
  window.addEventListener('pageshow',function(e){if(e.persisted) refresh();});
  setInterval(function(){if(ready || expired) render();},1000);
  setInterval(function(){if(document.visibilityState==='visible' && document.getElementById('f').dataset.submitting!=='true') refresh();},60000);
  refresh();
  return {update:update,canSubmit:function(){
    if(offer) render();
    if(expired) return false;
    if(!ready){alert('참가비를 확인 중이에요. 잠시 후 다시 시도해 주세요.');return false;}
    return true;
  }};
};
