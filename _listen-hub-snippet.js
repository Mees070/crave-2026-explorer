function listenHubHtml(a,stageColor){
  const vids=ytVideos(a);
  const scUrl=scEmbedUrl(a);
  const hasYt=vids.length>0;
  const hasSc=!!scUrl;
  if(!hasYt&&!hasSc)return '';

  const ytList=hasYt?vids.map((v,i)=>`<button type="button" class="q-item${i===ytIdx?' on':''}" onclick="playYtVideo('${v.id}',${i})">
    <span class="q-item-n">${v.title}</span>
    ${v.views?`<span class="q-item-m">${v.views}</span>`:''}
  </button>`).join(''):'<p class="listen-empty">No videos in catalog</p>';

  const tabYt=hasYt?`<button type="button" class="listen-tab${listenTab==='yt'?' on':''}" data-tab="yt" onclick="setListenTab('yt')">YouTube</button>`:'';
  const tabSc=hasSc?`<button type="button" class="listen-tab${listenTab==='sc'?' on':''}" data-tab="sc" onclick="setListenTab('sc')">SoundCloud</button>`:'';

  const panelYt=hasYt?`<div class="listen-panel${listenTab==='yt'?' on':''}" data-panel="yt">
    <div class="listen-stage"><div id="ytPlayer" class="listen-player"></div></div>
    <div class="listen-queue">${ytList}</div>
  </div>`:'';

  const panelSc=hasSc?`<div class="listen-panel${listenTab==='sc'?' on':''}" data-panel="sc">
    <div class="listen-stage listen-stage--sc">
      <div class="listen-sc-embed"><iframe id="scEmbed" height="152" scrolling="no" allow="autoplay" src="${scUrl}"></iframe></div>
    </div>
    <div class="listen-queue listen-queue--sc">
      <div class="listen-queue-hdr">
        <span class="sec" style="margin:0">Tracks</span>
        <div class="trk-sort">
          <button type="button" class="tsrt${trkSort==='plays'?' on':''}" data-ts="plays" onclick="setTrkSort('plays',this)">Plays</button>
          <button type="button" class="tsrt${trkSort==='title'?' on':''}" data-ts="title" onclick="setTrkSort('title',this)">Title</button>
          <button type="button" class="tsrt${trkSort==='duration'?' on':''}" data-ts="duration" onclick="setTrkSort('duration',this)">Length</button>
        </div>
      </div>
      <div class="sc-note" id="scNote"></div>
      <div class="tracks" id="tracks"></div>
    </div>
  </div>`:'';

  return `<section class="listen" id="listenHub" style="--listen-accent:${stageColor}">
    <div class="listen-hdr">
      <span class="listen-title">Listen</span>
      <div class="listen-tabs">${tabYt}${tabSc}</div>
    </div>
    <div class="listen-body">${panelYt}${panelSc}</div>
    <p class="listen-hint">Now playing syncs with the bar below · one source at a time</p>
  </section>`;
}

function setListenTab(tab){
  if(tab===listenTab)return;
  if(tab==='sc')pauseYouTube();
  if(tab==='yt'&&playing)pauseSoundCloud();
  listenTab=tab;
  document.querySelectorAll('.listen-tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  document.querySelectorAll('.listen-panel').forEach(p=>p.classList.toggle('on',p.dataset.panel===tab));
}

function syncPlayerTransport(){
  const srcEl=document.getElementById('playerSource');
  const trackEl=document.getElementById('playerTrack');
  const btnPlay=document.getElementById('btnPlay');
  const a=A.find(x=>x.id===sel);
  if(!srcEl||!trackEl||!btnPlay)return;

  if(mediaSource==='yt'){
    const vids=a?ytVideos(a):[];
    const v=vids[ytIdx];
    srcEl.className='psrc psrc--yt';
    srcEl.textContent='YouTube';
    trackEl.textContent=v?.title||'Video';
    btnPlay.textContent=ytPlaying?'⏸':'▶';
    btnPlay.title=ytPlaying?'Pause video':'Play video';
    document.getElementById('btnPrevT').disabled=!vids.length;
    document.getElementById('btnNextT').disabled=!vids.length;
  }else if(mediaSource==='sc'){
    const s=sounds[trackIdx];
    srcEl.className='psrc psrc--sc';
    srcEl.textContent='SoundCloud';
    trackEl.textContent=s?.title||'Track';
    btnPlay.textContent=playing?'⏸':'▶';
    btnPlay.title=playing?'Pause':'Play';
    document.getElementById('btnPrevT').disabled=!widgetReady||!sounds.length;
    document.getElementById('btnNextT').disabled=!widgetReady||!sounds.length;
  }else{
    srcEl.className='psrc psrc--idle';
    srcEl.textContent='Ready';
    trackEl.textContent='Select a video or track';
    btnPlay.textContent='▶';
    btnPlay.title='Play / pause';
    document.getElementById('btnPrevT').disabled=true;
    document.getElementById('btnNextT').disabled=true;
  }
}
