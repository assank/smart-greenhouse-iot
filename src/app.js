const $=id=>document.getElementById(id);
const controller=new GreenhouseController();
$('close-transfer').addEventListener('click',()=>{$('transfer-panel').hidden=true;});
const presets={normal:{temperature:25,humidity:60,soil:45,light:65,water:75,hour:14,clockValid:true},hot:{temperature:32,humidity:60,soil:45,light:65,water:75,hour:14,clockValid:true},dry:{temperature:25,humidity:60,soil:25,light:65,water:75,hour:14,clockValid:true},empty:{temperature:25,humidity:60,soil:25,light:65,water:10,hour:14,clockValid:true},dark:{temperature:25,humidity:60,soil:45,light:15,water:75,hour:14,clockValid:true},night:{temperature:25,humidity:60,soil:45,light:5,water:75,hour:23,clockValid:true},fault:{temperature:25,humidity:60,soil:45,light:65,water:NaN,hour:14,clockValid:true}};
const explanations={normal:'Система наблюдает за показаниями. Сейчас полив, вентиляция и досветка не нужны.',hot:'Температура поднялась до 32 °C. Вентилятор включается и остаётся включённым до охлаждения до 26,5 °C.',dry:'Почва сухая. Насос включается на срок до 6 секунд, затем выдерживает паузу 12 секунд.',empty:'Почва сухая, но воды осталось 10 %. Защита блокирует полив, чтобы насос не работал без воды.',dark:'Сейчас день, но света мало. Система включает досветку. Она выключится при освещённости от 45 %.',night:'Сейчас 23:00. По расписанию лампа выключена, даже если в теплице темно.',fault:'Датчик уровня не возвращает корректное измерение. Система блокирует насос и сообщает о сбое.'};
let input={...presets.normal},selected='normal',mode='demo',client=null,lastSeen=0,liveState=null,connected=false,pendingScenario=null;
let lastSample=0,start=performance.now(),history=[],lastHistory=0,labelVisible=true,selection='esp';
const deviceInfo={esp:['ESP32 — центр управления','Получает показания датчиков, сравнивает их с порогами и включает нужные устройства. Управление продолжает работать без интернета.'],climate:['DHT22 — климат в теплице','Измеряет температуру и влажность воздуха. По температуре ESP32 управляет вентилятором. Влажность воздуха отображается для наблюдения.'],soil:['Датчик влажности почвы','Помогает определить, нужен ли полив. В Wokwi его сигнал задаёт потенциометр. Шкала 0–100 % в прототипе относительная.'],light:['Фоторезистор — освещённость','Отслеживает относительный уровень света. Днём при недостатке света включается лампа. Ночью досветку блокирует расписание.'],water:['HC-SR04 — уровень воды','Измеряет расстояние до поверхности воды. Для модели бака 4 см соответствует полному баку, 40 см — пустому.'],pump:['Насос и капельный полив','Подаёт воду из бака в грядки. Работает не дольше 6 секунд за один цикл. После остановки выдерживает паузу 12 секунд.'],fan:['Вентилятор','Включается при 28,5 °C, выключается при 26,5 °C. Между порогами сохраняет предыдущее состояние.'],lamp:['Фитолампа','Включается днём при свете ниже 30 %, выключается при 45 %. С 22:00 до 06:00 всегда выключена.']};
function chooseDevice(key){selection=key;$('device-picker').value=key;$('device-title').textContent=deviceInfo[key][0];$('device-description').textContent=deviceInfo[key][1];document.querySelectorAll('.pin').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.device===key)));}
$('device-picker').addEventListener('change',()=>chooseDevice($('device-picker').value));
function syncInputs(){for(const key of ['temperature','humidity','soil','water','light']){const v=input[key];$(key).value=Number.isFinite(v)?v:0;$(key+'-output').textContent=Number.isFinite(v)?`${Number(v.toFixed(1))} ${key==='temperature'?'°C':'%'}`:'Ошибка';}const opt=Array.from($('hour').options).find(o=>Number(o.value)===input.hour);if(opt)$('hour').value=input.hour;}
function pressScenario(key){
 if(mode==='live'){
   if(client?.connected&&lastSeen&&performance.now()-lastSeen<5000){client.publish(TOPIC_COMMAND,key);pendingScenario=key;$('connection-note').textContent='Команда отправлена. Ждём подтверждения ESP32…';}
   else $('connection-note').textContent='Нет свежих показаний ESP32. Запустите симулятор или вернитесь в демо.';
   return;
 }
 selected=key;input={...presets[key]};controller.reset();controller.sample(input);controller.tick(performance.now()-start);lastSample=performance.now();syncInputs();update();
}
document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>pressScenario(b.dataset.scenario)));
for(const key of ['temperature','humidity','soil','water','light'])$(key).addEventListener('input',()=>{if(mode!=='demo')return;selected='custom';input[key]=Number($(key).value);syncInputs();});
$('hour').addEventListener('change',()=>{if(mode==='demo'){input.hour=Number($('hour').value);selected='custom';controller.sample(input);controller.tick(performance.now()-start);update();}});
function displayed(){return mode==='live'&&liveState?liveState:{...input,...controller.out,filteredTemperature:controller.filtered.temperature,filteredSoil:controller.filtered.soil};}
function update(){
 const s=displayed(),o=mode==='live'?(liveState||{}):controller.out;
 const stale=mode==='live'&&(!lastSeen||performance.now()-lastSeen>5000);
 document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===selected)));
 $('explanation').textContent=explanations[selected]||(selected==='sensors'?'Показания приходят с датчиков Wokwi. Меняйте условия в симуляторе, чтобы проверить реакцию ESP32.':'Условия изменены вручную. Решения используют сглаженные показания и предыдущие состояния устройств.');
 for(const [key,onText,offText] of [['pump','Работает','Выключен'],['fan','Работает','Выключена'],['lamp','Включена','Выключена']]){
   $('device-'+key).classList.toggle('active',!!o[key]&&!stale);$(key+'-value').textContent=stale?(liveState?'Нет свежих данных':'Нет данных'):o[key]?onText:offText;
 }
 let note='Почва достаточно влажная';
 if(o.sensorFault)note='Проверка датчиков';else if(o.waterLow)note='Блокировка: мало воды';else if(o.pump){note=mode==='demo'?`До остановки: ${Math.max(0,Math.ceil((6000-(((performance.now()-start)>>>0)-o.pumpStarted))/1000))} с`:'Лимит одного цикла: 6 с';}else if(o.cooldown){note=mode==='demo'?`Пауза: ${Math.max(0,Math.ceil((12000-((((performance.now()-start)>>>0)-o.pumpStopped)>>>0))/1000))} с`:'Пауза между поливами: 12 с';}
 $('pump-note').textContent=note;
 if(stale)$('pump-note').textContent=liveState?'Последнее состояние сохранено':'Запустите ESP32 в Wokwi';
 let status='Автоматический режим. Устройства управляются по показаниям.';
 if(mode==='live'&&!liveState)status='Ждём показаний ESP32. Устройства пока не отображаются.';
 else if(mode==='live'&&performance.now()-lastSeen>5000)status='Связь с ESP32 потеряна. Показаны последние полученные значения.';
 else if(o.sensorFault)status='Сбой датчика. Проверьте корректность показаний.';
 else if(o.waterLow)status='Мало воды. Насос заблокирован, пополните бак.';
 else if(!s.clockValid)status='Время ещё не синхронизировано. Досветка заблокирована.';
 else if(o.cooldown)status='Насос остановлен. Выдерживается пауза между поливами.';
 else if(s.hour>=22||s.hour<6)status='Ночной режим. Досветка заблокирована по расписанию.';
 $('status').textContent=status;$('status').classList.toggle('alert',!!o.waterLow||!!o.sensorFault||(mode==='live'&&performance.now()-lastSeen>5000));
 $('source').dataset.stale=String(mode==='live'&&(!lastSeen||performance.now()-lastSeen>5000));
 $('source-text').textContent=mode==='demo'?'Самостоятельная демонстрация':lastSeen&&performance.now()-lastSeen<5000?`ESP32 / Wokwi · ${liveState.source==='sensors'?'датчики':'сценарий'}`:'Wokwi · ожидание данных';
 if(model)model.apply(stale?{...s,pump:false,fan:false,lamp:false}:s);
}
function chart(){
 const canvas=$('chart'),w=canvas.clientWidth,h=110,dpr=Math.min(devicePixelRatio,2);canvas.width=w*dpr;canvas.height=h*dpr;
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const st=getComputedStyle(document.documentElement);
 const min=10,max=45,x0=34,x1=w-8,y0=7,y1=85;
 ctx.strokeStyle=st.getPropertyValue('--line');ctx.fillStyle=st.getPropertyValue('--muted');ctx.font='11px Arial';ctx.lineWidth=1;
 for(const t of [15,25,35,45]){const y=y1-(t-min)/(max-min)*(y1-y0);ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x1,y);ctx.stroke();ctx.fillText(t,5,y+4);}
 ctx.fillText('−60 с',x0,107);ctx.textAlign='right';ctx.fillText('Сейчас',x1,107);ctx.textAlign='left';
 const now=performance.now();ctx.strokeStyle=st.getPropertyValue('--active');ctx.lineWidth=2;ctx.beginPath();let first=true;
 for(const p of history){const x=x0+(1-(now-p.at)/60000)*(x1-x0),y=y1-(p.value-min)/(max-min)*(y1-y0);if(first){ctx.moveTo(x,y);first=false;}else ctx.lineTo(x,y);}ctx.stroke();
}
const TOPIC_STATE='smartgreenhouse/sg-8d37a9e6/state',TOPIC_COMMAND='smartgreenhouse/sg-8d37a9e6/command';
function setLiveControls(value){for(const key of ['temperature','humidity','soil','water','light','hour'])$(key).disabled=value;}
$('connect').addEventListener('click',()=>{
 if(client)return;
 mode='live';liveState=null;lastSeen=0;connected=false;setLiveControls(true);$('connect').hidden=true;$('disconnect').hidden=false;$('sensors-mode').hidden=false;$('connection-note').textContent='Подключаемся к брокеру MQTT…';update();
 client=mqtt.connect('wss://broker.hivemq.com:8884/mqtt',{clientId:'sg-8d37a9e6-ui-'+Math.random().toString(16).slice(2,10),connectTimeout:10000,reconnectPeriod:5000,clean:true});
 client.on('connect',()=>{connected=true;client.subscribe(TOPIC_STATE);$('connection-note').textContent='Брокер подключён. Ждём телеметрию ESP32…';});
 client.on('message',(topic,buffer)=>{
   if(topic!==TOPIC_STATE)return;
   try{const s=JSON.parse(buffer.toString());if(s.device!=='sg-8d37a9e6'||!Number.isFinite(s.uptime)||!['sensors',...Object.keys(presets)].includes(s.source)||!['pump','fan','lamp','waterLow','sensorFault','cooldown'].every(k=>typeof s[k]==='boolean'))return;
     liveState=s;lastSeen=performance.now();input={...s};selected=s.source;pendingScenario=null;syncInputs();$('connection-note').textContent='Получаем показания ESP32 каждую секунду.';update();
   }catch{ $('connection-note').textContent='Получен некорректный пакет. Ждём следующий.'; }
 });
 client.on('error',()=>{$('connection-note').textContent='Брокер недоступен. Проверьте интернет или вернитесь в демо.';});
 client.on('offline',()=>{connected=false;$('connection-note').textContent='MQTT отключён. Пробуем восстановить соединение…';update();});
});
$('disconnect').addEventListener('click',()=>{client?.end(true);client=null;mode='demo';liveState=null;lastSeen=0;setLiveControls(false);$('connect').hidden=false;$('disconnect').hidden=true;$('sensors-mode').hidden=true;$('connection-note').textContent='Интернет нужен только для связи с Wokwi.';pressScenario('normal');});
$('sensors-mode').addEventListener('click',()=>{if(client?.connected)client.publish(TOPIC_COMMAND,'sensors');});
$('snapshot').addEventListener('click',()=>{if(!model){$('copy-status').textContent='Снимок доступен при работающей 3D-модели.';return;}model.renderer.render(model.scene,model.camera);const a=document.createElement('a');a.href=model.renderer.domElement.toDataURL('image/png');a.download='greenhouse-'+selected+'.png';a.click();});
for(const [id,key] of [['copy-sketch','sketch'],['copy-diagram','diagram'],['copy-libraries','libraries']])$(id).addEventListener('click',async()=>{const text=FILES[key];$('transfer-panel').hidden=false;$('transfer').value=text;$('transfer-title').textContent={sketch:'sketch.ino',diagram:'diagram.json',libraries:'libraries.txt'}[key];try{await navigator.clipboard.writeText(text);$('copy-status').textContent=key==='libraries'?'Список библиотек скопирован. Добавьте их в Library Manager.':'Скопировано. Вставьте в соответствующий файл Wokwi.';}catch{$('copy-status').textContent='Выделите содержимое файла ниже и скопируйте его.';}});
let model=null;
function buildModel(){
 const stage=$('stage');
 const scene=new THREE.Scene();scene.background=new THREE.Color('#fbfaf7');scene.fog=new THREE.Fog('#fbfaf7',18,40);
 const camera=new THREE.PerspectiveCamera(34,1,.1,70);camera.position.set(8.4,6.2,9.4);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;stage.prepend(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(-.35,1.3,0);controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=5.8;controls.maxDistance=19;controls.maxPolarAngle=Math.PI/2.05;controls.enablePan=false;
 scene.add(new THREE.HemisphereLight('#fffcf2','#9eab99',2.4));const sun=new THREE.DirectionalLight('#ffecd2',3.2);sun.position.set(-4,10,7);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-7;sun.shadow.camera.right=7;sun.shadow.camera.top=7;sun.shadow.camera.bottom=-7;sun.shadow.bias=-.0004;scene.add(sun);
 const group=new THREE.Group();scene.add(group);
 const mats={frame:new THREE.MeshStandardMaterial({color:'#909b91',roughness:.45,metalness:.6}),wood:new THREE.MeshStandardMaterial({color:'#b2936f',roughness:.9}),soil:new THREE.MeshStandardMaterial({color:'#514438',roughness:1}),green:new THREE.MeshStandardMaterial({color:'#4d793f',roughness:.83,side:THREE.DoubleSide}),lightGreen:new THREE.MeshStandardMaterial({color:'#6f924e',roughness:.85,side:THREE.DoubleSide}),dark:new THREE.MeshStandardMaterial({color:'#263a33',roughness:.75}),box:new THREE.MeshStandardMaterial({color:'#dfddcb',roughness:.55}),water:new THREE.MeshPhysicalMaterial({color:'#3990bc',transparent:true,opacity:.6,roughness:.15,metalness:.03}),glass:new THREE.MeshPhysicalMaterial({color:'#dbe9dc',transparent:true,opacity:.14,roughness:.15,metalness:.05,depthWrite:false}),lamp:new THREE.MeshStandardMaterial({color:'#eee9ce',emissive:'#eabc55',emissiveIntensity:0,roughness:.3}),screen:new THREE.MeshStandardMaterial({color:'#153329',emissive:'#458574',emissiveIntensity:.4})};
 function mesh(geometry,material,x=0,y=0,z=0,parent=group){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function box(w,h,d,x,y,z,mat=mats.frame,parent=group){return mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent);}
 function tube(a,b,r=.03,mat=mats.frame,parent=group){const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),dir=vb.clone().sub(va);const m=mesh(new THREE.CylinderGeometry(r,r,dir.length(),10),mat,0,0,0,parent);m.position.copy(va.clone().add(vb).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return m;}
 const ground=mesh(new THREE.PlaneGeometry(180,180),new THREE.MeshStandardMaterial({color:'#f3f0e8',roughness:1}),0,-.12,0,scene);ground.rotation.x=-Math.PI/2;
 box(5.1,.18,4.2,0,0,0,mats.box);box(4.8,.08,3.9,0,.13,0,new THREE.MeshStandardMaterial({color:'#e3dace',roughness:1}));
 const p={a:[-2.4,.2,1.9],b:[2.4,.2,1.9],c:[2.4,.2,-1.9],d:[-2.4,.2,-1.9]};
 for(const [x,z] of [[-2.4,-1.9],[2.4,-1.9],[-2.4,1.9],[2.4,1.9]]){tube([x,.1,z],[x,2.85,z],.045);box(.16,.25,.16,x,.05,z,mats.dark);}
 for(const z of [-1.9,1.9]){tube([-2.4,2.85,z],[0,3.9,z],.045);tube([0,3.9,z],[2.4,2.85,z],.045);tube([-2.4,2.85,z],[2.4,2.85,z],.035);tube([-2.4,.2,z],[2.4,.2,z],.045);}
 for(const x of [-2.4,2.4]){tube([x,2.85,-1.9],[x,2.85,1.9],.045);tube([x,.2,-1.9],[x,.2,1.9],.045);}
 tube([0,3.9,-1.9],[0,3.9,1.9],.045);
 for(const z of [-.65,.65]){tube([-2.4,2.85,z],[0,3.9,z],.027);tube([0,3.9,z],[2.4,2.85,z],.027);}
 const roof=new THREE.Group();group.add(roof);const side=new THREE.Group();group.add(side);
 box(4.75,2.5,.02,0,1.52,-1.88,mats.glass,side);box(.02,2.5,3.75,-2.38,1.52,0,mats.glass,side);
 for(const sign of [-1,1]){const r=box(2.62,.018,3.75,sign*1.2,3.37,0,mats.glass,roof);r.rotation.z=-sign*.411;}
 // The open front and right side reveal the mechanism.
 const leafShape=new THREE.Shape();leafShape.moveTo(0,0);leafShape.quadraticCurveTo(.22,.17,.035,.47);leafShape.quadraticCurveTo(-.18,.27,0,0);const leafGeo=new THREE.ShapeGeometry(leafShape,9);
 for(const bx of [-1.35,1.35]){
   box(1.6,.47,3.2,bx,.38,0,mats.wood);box(1.43,.05,3.06,bx,.64,0,mats.soil);
   for(const x of [bx-.8,bx+.8])for(const z of [-1.6,1.6])box(.07,.48,.07,x,.4,z,mats.frame);
   for(let n=0;n<4;n++){const z=-1.15+n*.75;for(const dx of [-.35,.35]){const plant=new THREE.Group();plant.position.set(bx+dx,.66,z);group.add(plant);tube([0,0,0],[0,.53,0],.011,mats.green,plant);for(let k=0;k<6;k++){const pivot=new THREE.Group();pivot.position.y=.04+k*.065;pivot.rotation.y=k*2.399+n*.9;plant.add(pivot);const leaf=mesh(leafGeo,k%2?mats.green:mats.lightGreen,0,0,0,pivot);leaf.rotation.x=.75+(k%3)*.13;leaf.scale.setScalar(.65+(5-k)*.09);}}}
   tube([bx,.69,-1.5],[bx,.69,1.5],.018,mats.dark);
 }
 const tankX=-3.45,tankZ=1.0;
 const tank=mesh(new THREE.CylinderGeometry(.48,.48,1.3,40,1,true),new THREE.MeshPhysicalMaterial({color:'#d7e8ea',transparent:true,opacity:.2,roughness:.1,depthWrite:false}),tankX,.85,tankZ);tank.castShadow=false;
 const water=mesh(new THREE.CylinderGeometry(.455,.455,1,40),mats.water,tankX,.7,tankZ);water.castShadow=false;
 mesh(new THREE.CylinderGeometry(.5,.5,.07,40),mats.frame,tankX,.2,tankZ);mesh(new THREE.CylinderGeometry(.5,.5,.06,40),mats.frame,tankX,1.52,tankZ);
 tube([tankX,1.55,tankZ],[tankX,1.82,tankZ],.025);box(.23,.12,.1,tankX,1.85,tankZ,mats.box);for(const dx of [-.06,.06]){const disc=mesh(new THREE.CylinderGeometry(.038,.038,.025,18),mats.frame,tankX+dx,1.85,tankZ+.062);disc.rotation.x=Math.PI/2;}
 const pump=box(.3,.23,.35,tankX,.37,tankZ+.05,mats.dark);tube([tankX,.37,tankZ+.23],[-2.65,.37,1.22],.033,mats.dark);tube([-2.65,.37,1.22],[-2.65,.72,1.22],.03,mats.dark);tube([-2.65,.72,1.22],[1.35,.72,1.22],.03,mats.dark);for(const bx of [-1.35,1.35])tube([bx,.72,1.22],[bx,.72,-1.45],.027,mats.dark);
 const flows=[];const flowMat=new THREE.MeshBasicMaterial({color:'#38a9dd'});for(let i=0;i<16;i++){const m=mesh(new THREE.SphereGeometry(.042,8,6),flowMat);m.visible=false;flows.push(m);}
 const electronics=box(.43,.62,.26,-2.95,.8,-.06,mats.box);box(.3,.18,.02,-2.95,.93,.083,mats.screen);for(let i=0;i<3;i++)box(.23,.012,.023,-2.95,.89+i*.045,.1,new THREE.MeshBasicMaterial({color:'#91cdb4'}));tube([-2.75,.8,0],[-2.38,.8,0],.014,mats.dark);
 const sensor=box(.14,.23,.08,-2.28,1.75,-.5,mats.box);for(let i=0;i<4;i++)box(.08,.008,.012,-2.28,1.70+i*.025,-.451,mats.dark);
 box(.10,.14,.12,1.2,2.82,-1.78,mats.box);mesh(new THREE.SphereGeometry(.045,12,8),mats.dark,1.2,2.9,-1.78);
 box(.1,.35,.045,.94,.75,.7,mats.dark);box(.11,.13,.065,.94,.96,.7,mats.box);
 box(.82,.82,.11,0,2.14,-1.8,mats.dark);const fanHub=new THREE.Group();fanHub.position.set(0,2.14,-1.72);group.add(fanHub);
 for(let i=0;i<4;i++){const blade=mesh(new THREE.BoxGeometry(.1,.34,.035),mats.frame,0,.17,0,fanHub);const carrier=new THREE.Group();carrier.rotation.z=i*Math.PI/2;fanHub.remove(blade);carrier.add(blade);fanHub.add(carrier);}const hub=mesh(new THREE.CylinderGeometry(.085,.085,.06,24),mats.dark,0,0,.04,fanHub);hub.rotation.x=Math.PI/2;
 const airMat=new THREE.MeshBasicMaterial({color:'#8cb7a4',transparent:true,opacity:.6});const airs=[];for(let i=0;i<9;i++){const a=mesh(new THREE.SphereGeometry(.025,6,4),airMat);a.visible=false;airs.push(a);}
 const lampMeshes=[],lampLights=[];for(const x of [-1.35,1.35]){tube([x,3.2,-1.3],[x,2.75,-1.3],.014);tube([x,3.2,1.3],[x,2.75,1.3],.014);box(.18,.07,2.8,x,2.7,0,mats.frame);lampMeshes.push(box(.13,.02,2.65,x,2.652,0,mats.lamp));const light=new THREE.PointLight('#f6d27a',0,4,2);light.position.set(x,2.4,0);group.add(light);lampLights.push(light);}
 const pins=[];const pinDefs=[['esp',[-2.95,1.18,0],'ESP32'],['water',[tankX,1.86,tankZ],'Уровень воды'],['pump',[tankX,.37,tankZ+.25],'Насос'],['climate',[-2.24,1.78,-.5],'DHT22'],['soil',[.94,1.0,.7],'Датчик почвы'],['fan',[0,2.42,-1.7],'Вентилятор'],['lamp',[1.35,2.71,0],'Фитолампа']];
 for(const [key,position,text] of pinDefs){const b=document.createElement('button');b.className='pin';b.dataset.device=key;b.textContent=text;b.setAttribute('aria-pressed',String(key===selection));b.addEventListener('click',()=>chooseDevice(key));stage.append(b);pins.push({button:b,position:new THREE.Vector3(...position)});}
 let s=displayed(),view='cut',targetCamera=null;
 function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
 new ResizeObserver(resize).observe(stage);resize();
 function setView(kind){view=kind;roof.visible=kind==='wide';side.visible=kind==='wide';controls.target.set(-.35,1.3,0);targetCamera=new THREE.Vector3(...(kind==='top'?[.01,12.5,3]:kind==='wide'?[9,6.8,11]:[8.4,6.2,9.4]));['cut','top','wide'].forEach(k=>$('view-'+k).setAttribute('aria-pressed',String(k===kind)));}
 ['cut','top','wide'].forEach(k=>$('view-'+k).addEventListener('click',()=>setView(k)));
 $('labels').addEventListener('click',()=>{labelVisible=!labelVisible;$('labels').setAttribute('aria-pressed',String(labelVisible));});
 setView('cut');const reduced=matchMedia('(prefers-reduced-motion: reduce)');let previous=performance.now();
 function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-previous)/1000,.1);previous=now;if(targetCamera){camera.position.lerp(targetCamera,reduced.matches?1:.065);if(camera.position.distanceTo(targetCamera)<.01)targetCamera=null;}controls.update();
   if(!reduced.matches&&s.fan)fanHub.rotation.z-=dt*9;
   flows.forEach((m,i)=>{m.visible=!!s.pump;const progress=reduced.matches?i/16:((now/2200+i/16)%1);m.position.set(-2.65+progress*4,.73,1.22);});
   airs.forEach((m,i)=>{m.visible=!!s.fan;const progress=reduced.matches?i/9:((now/1900+i/9)%1);m.position.set(Math.sin(i*2.4)*.25,2.07+Math.cos(i*1.5)*.2,-1.5+progress*2.7);});
   const occupied=[];
   for(const p of pins){const point=p.position.clone().project(camera);const bw=p.button.offsetWidth||80;let px=(point.x*.5+.5)*stage.clientWidth,py=(-point.y*.5+.5)*stage.clientHeight;px=Math.max(bw/2+8,Math.min(stage.clientWidth-bw/2-8,px));py=Math.max(80,Math.min(stage.clientHeight-40,py));for(let pass=0;pass<8;pass++){if(occupied.some(q=>Math.abs(q.x-px)<(q.w+bw)/2+5&&Math.abs(q.y-py)<28))py+=28;else break;}occupied.push({x:px,y:py,w:bw});p.button.style.left=px+'px';p.button.style.top=py+'px';p.button.classList.toggle('pin-hidden',!labelVisible||point.z>1||view==='top'||stage.clientWidth<450);}
   renderer.render(scene,camera);
 }
 requestAnimationFrame(animate);
 return {apply(state){s=state;const level=Number.isFinite(state.water)?Math.max(.025,state.water/100):.025;water.scale.y=level;water.position.y=.22+.5*level;mats.lamp.emissiveIntensity=state.lamp?3:0;lampLights.forEach(l=>l.intensity=state.lamp?4:0);},renderer,scene,camera};
}
try{model=buildModel();}catch(e){const img=document.createElement('img');img.className='fallback';img.src='assets/concept.png';img.alt='Концептуальная теплица с датчиками и устройствами';$('stage').prepend(img);const note=document.createElement('div');note.className='fallback-note';note.textContent='Браузер не поддерживает 3D. Показана иллюстрация, управление и сценарии работают.';$('stage').append(note);for(const k of ['cut','top','wide'])$('view-'+k).disabled=true;$('stage-hint').textContent='Иллюстрация предполагаемой конструкции';console.warn('3D unavailable',e.message);}
pressScenario('normal');
setInterval(()=>{const now=performance.now();if(mode==='demo'){if(now-lastSample>=2000){controller.sample(input);lastSample=now;}controller.tick(now-start);}update();if(now-lastHistory>=1000){lastHistory=now;const s=displayed();if(Number.isFinite(s.filteredTemperature)&&(mode==='demo'||lastSeen&&now-lastSeen<5000))history.push({at:now,value:s.filteredTemperature});history=history.filter(p=>now-p.at<60000);chart();}},100);
new ResizeObserver(chart).observe($('chart'));
