// Smart Greenhouse. Arduino / ESP32.
// Shared controller is embedded so Wokwi needs only this sketch.

#include <stdint.h>
#include <math.h>

struct Readings {
  float temperature=25, humidity=60, soil=45, light=65, water=75;
  int hour=14;
  bool clockValid=true;
};
struct Outputs {
  bool pump=false, fan=false, lamp=false, waterLow=false, sensorFault=false;
  uint32_t pumpStarted=0, pumpStopped=0;
  bool cooldown=false;
};
class GreenhouseController {
 public:
  Readings filtered;
  Outputs out;
  bool initialized=false;
  static bool valid(float v,float low,float high){return isfinite(v)&&v>=low&&v<=high;}
  void reset(){out=Outputs();initialized=false;}
  void sample(const Readings& r){
    if(!initialized){filtered=r;initialized=true;}
    else {
      filtered.temperature=smooth(filtered.temperature,r.temperature,-40,80);
      filtered.humidity=smooth(filtered.humidity,r.humidity,0,100);
      filtered.soil=smooth(filtered.soil,r.soil,0,100);
      filtered.light=smooth(filtered.light,r.light,0,100);
      filtered.water=smooth(filtered.water,r.water,0,100);
      filtered.hour=r.hour;filtered.clockValid=r.clockValid;
    }
    raw=r;
  }
  void tick(uint32_t now){
    if(!initialized)return;
    const bool waterOk=valid(raw.water,0,100);
    const bool soilOk=valid(raw.soil,0,100);
    const bool temperatureOk=valid(raw.temperature,-40,80);
    const bool lightOk=valid(raw.light,0,100);
    out.waterLow=waterOk && (raw.water<=15 || filtered.water<=15);
    out.sensorFault=!waterOk||!soilOk||!temperatureOk||!lightOk||!valid(raw.humidity,0,100);
    const bool irrigationAllowed=waterOk&&soilOk&&!out.waterLow;
    if(out.cooldown && uint32_t(now-out.pumpStopped)>=12000)out.cooldown=false;
    if(out.pump && (!irrigationAllowed || filtered.soil>=55 || uint32_t(now-out.pumpStarted)>=6000)){
      out.pump=false;out.pumpStopped=now;out.cooldown=true;
    }
    if(!out.pump && !out.cooldown && irrigationAllowed && filtered.soil<35){out.pump=true;out.pumpStarted=now;}
    if(!temperatureOk)out.fan=true;
    else if(filtered.temperature>=28.5f)out.fan=true;
    else if(filtered.temperature<=26.5f)out.fan=false;
    const bool night=filtered.hour>=22||filtered.hour<6;
    if(!lightOk||!filtered.clockValid||night)out.lamp=false;
    else if(filtered.light<30)out.lamp=true;
    else if(filtered.light>=45)out.lamp=false;
  }
 private:
  Readings raw;
  static float smooth(float previous,float value,float low,float high){
    if(!valid(value,low,high))return previous;
    return valid(previous,low,high)?previous+0.25f*(value-previous):value;
  }
};

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Preferences.h>
#include <time.h>

// Educational demo. The shared public broker carries synthetic data only.
const char* MQTT_HOST="broker.hivemq.com";
const char* TOPIC_STATE="smartgreenhouse/sg-8d37a9e6/state";
const char* TOPIC_COMMAND="smartgreenhouse/sg-8d37a9e6/command";
const int DHT_PIN=4, SOIL_PIN=34, LIGHT_PIN=35, TRIG_PIN=18, ECHO_PIN=5;
const int PUMP_PIN=19, FAN_PIN=23, LAMP_PIN=13, BUZZER_PIN=27;
DHT dht(DHT_PIN,DHT22);
Adafruit_SSD1306 display(128,64,&Wire,-1);
WiFiClient network;
PubSubClient mqtt(network);
Preferences prefs;
GreenhouseController greenhouse;
Readings readings;
String scenario="sensors", commandBuffer;
bool screenAvailable=false;
uint32_t lastSensor=0,lastPublish=0,lastMqttAttempt=0,lastWifiAttempt=0;
bool previousAlarm=false;
volatile bool mqttOnline=false;
struct StatePacket { char text[600]; };
struct IncomingCommand { char text[25]; };
QueueHandle_t stateQueue,commandQueue;

void applyScenario(String value,bool persist=true){
  value.trim();value.toLowerCase();
  if(value!="sensors"&&value!="normal"&&value!="hot"&&value!="dry"&&value!="empty"&&value!="dark"&&value!="night"&&value!="fault"){
    Serial.println("Commands: sensors normal hot dry empty dark night fault");return;
  }
  scenario=value;
  greenhouse.reset();
  digitalWrite(PUMP_PIN,LOW);digitalWrite(FAN_PIN,LOW);digitalWrite(LAMP_PIN,LOW);
  if(persist)prefs.putString("scenario",scenario);
  // Make the next sensor cycle immediate.
  lastSensor=millis()-2000;
  Serial.print("SCENARIO ");Serial.println(scenario);
}
void onMessage(char* topic,byte* payload,unsigned int length){
  if(String(topic)!=TOPIC_COMMAND||length>24)return;
  IncomingCommand command={};
  memcpy(command.text,payload,length);command.text[length]=0;
  xQueueSend(commandQueue,&command,0);
}
void networkTask(void*){
  StatePacket packet={};
  for(;;){
    uint32_t now=millis();
    if(WiFi.status()==WL_CONNECTED){
      if(!mqtt.connected()&&uint32_t(now-lastMqttAttempt)>=10000){lastMqttAttempt=now;if(mqtt.connect("sg-8d37a9e6-esp32"))mqtt.subscribe(TOPIC_COMMAND);}
      mqttOnline=mqtt.connected();
      if(mqttOnline){mqtt.loop();if(xQueueReceive(stateQueue,&packet,0)==pdTRUE)mqtt.publish(TOPIC_STATE,packet.text,false);}
    }else{mqttOnline=false;if(uint32_t(now-lastWifiAttempt)>=20000){lastWifiAttempt=now;WiFi.reconnect();}}
    vTaskDelay(pdMS_TO_TICKS(30));
  }
}
float readWater(){
  digitalWrite(TRIG_PIN,LOW);delayMicroseconds(2);
  digitalWrite(TRIG_PIN,HIGH);delayMicroseconds(10);digitalWrite(TRIG_PIN,LOW);
  unsigned long pulse=pulseIn(ECHO_PIN,HIGH,26000);
  if(!pulse)return NAN;
  float distance=pulse/58.0f;
  return constrain((40.0f-distance)/36.0f*100.0f,0.0f,100.0f);
}
void acquire(){
  readings=Readings();
  if(scenario=="sensors"){
    readings.temperature=dht.readTemperature();readings.humidity=dht.readHumidity();
    readings.soil=analogRead(SOIL_PIN)*100.0f/4095.0f;
    readings.light=(4095.0f-analogRead(LIGHT_PIN))*100.0f/4095.0f;
    readings.water=readWater();
    struct tm local;
    readings.clockValid=getLocalTime(&local,0);
    readings.hour=readings.clockValid?local.tm_hour:0;
  } else {
    readings.clockValid=true;readings.hour=14;
    if(scenario=="hot")readings.temperature=32;
    if(scenario=="dry"||scenario=="empty")readings.soil=25;
    if(scenario=="empty")readings.water=10;
    if(scenario=="dark")readings.light=15;
    if(scenario=="night"){readings.light=5;readings.hour=23;}
    if(scenario=="fault")readings.water=NAN;
  }
  greenhouse.sample(readings);
}
void actuate(){
  const auto& o=greenhouse.out;
  digitalWrite(PUMP_PIN,o.pump?HIGH:LOW);
  digitalWrite(FAN_PIN,o.fan?HIGH:LOW);
  digitalWrite(LAMP_PIN,o.lamp?HIGH:LOW);
  bool alarm=o.waterLow||o.sensorFault;
  if(alarm!=previousAlarm){if(alarm)tone(BUZZER_PIN,1800);else noTone(BUZZER_PIN);previousAlarm=alarm;}
}
void drawScreen(){
  if(!screenAvailable)return;
  const auto& f=greenhouse.filtered;const auto& o=greenhouse.out;
  display.clearDisplay();display.setTextColor(SSD1306_WHITE);display.setTextSize(1);display.setCursor(0,0);
  display.println("SMART GREENHOUSE");
  display.printf("T:%4.1fC H:%3.0f%%\n",f.temperature,f.humidity);
  display.printf("Soil:%3.0f Light:%3.0f\n",f.soil,f.light);
  if(isfinite(readings.water))display.printf("Water:%3.0f%% %s\n",f.water,readings.clockValid?"TIME OK":"NO TIME");
  else display.println("WATER SENSOR ERROR");
  display.printf("P:%d F:%d L:%d\n",o.pump,o.fan,o.lamp);
  display.println(o.sensorFault?"SENSOR FAULT":o.waterLow?"LOW WATER":o.cooldown?"PUMP COOLDOWN":"AUTO CONTROL");
  display.printf("%s %s",scenario.c_str(),mqttOnline?"MQTT":"LOCAL");display.display();
}
void numberJson(char* buf,size_t len,float value){
  if(isfinite(value))snprintf(buf,len,"%.1f",value);else snprintf(buf,len,"null");
}
void publishState(){
  const auto& f=greenhouse.filtered;const auto& o=greenhouse.out;
  char t[16],h[16],s[16],l[16],w[16],ft[16],fs[16],packet[600];
  numberJson(t,sizeof(t),readings.temperature);numberJson(h,sizeof(h),readings.humidity);
  numberJson(s,sizeof(s),readings.soil);numberJson(l,sizeof(l),readings.light);numberJson(w,sizeof(w),readings.water);
  numberJson(ft,sizeof(ft),f.temperature);numberJson(fs,sizeof(fs),f.soil);
  snprintf(packet,sizeof(packet),"{\"device\":\"sg-8d37a9e6\",\"source\":\"%s\",\"uptime\":%lu,\"temperature\":%s,\"humidity\":%s,\"soil\":%s,\"light\":%s,\"water\":%s,\"hour\":%d,\"clockValid\":%s,\"filteredTemperature\":%s,\"filteredSoil\":%s,\"pump\":%s,\"fan\":%s,\"lamp\":%s,\"waterLow\":%s,\"sensorFault\":%s,\"cooldown\":%s}",scenario.c_str(),(unsigned long)millis(),t,h,s,l,w,readings.hour,readings.clockValid?"true":"false",ft,fs,o.pump?"true":"false",o.fan?"true":"false",o.lamp?"true":"false",o.waterLow?"true":"false",o.sensorFault?"true":"false",o.cooldown?"true":"false");
  Serial.println(packet);
  StatePacket queued={};strncpy(queued.text,packet,sizeof(queued.text)-1);xQueueOverwrite(stateQueue,&queued);
}
void setup(){
  Serial.begin(115200);
  for(int pin:{PUMP_PIN,FAN_PIN,LAMP_PIN,BUZZER_PIN}){pinMode(pin,OUTPUT);digitalWrite(pin,LOW);}
  pinMode(TRIG_PIN,OUTPUT);pinMode(ECHO_PIN,INPUT);analogReadResolution(12);
  Wire.begin(21,22);dht.begin();
  screenAvailable=display.begin(SSD1306_SWITCHCAPVCC,0x3c);
  prefs.begin("greenhouse",false);
  WiFi.mode(WIFI_STA);WiFi.begin("Wokwi-GUEST","",6);
  configTime(5*3600,0,"pool.ntp.org","time.google.com");
  mqtt.setServer(MQTT_HOST,1883);mqtt.setCallback(onMessage);mqtt.setBufferSize(768);mqtt.setSocketTimeout(30);
  network.setTimeout(1000);
  stateQueue=xQueueCreate(1,sizeof(StatePacket));commandQueue=xQueueCreate(4,sizeof(IncomingCommand));
  if(!stateQueue||!commandQueue){Serial.println("Queue allocation failed");for(;;)delay(1000);}
  applyScenario(prefs.getString("scenario","sensors"),false);
  xTaskCreatePinnedToCore(networkTask,"network",8192,nullptr,1,nullptr,0);
  Serial.println("Ready. Enter a scenario in Serial Monitor or use the 3D dashboard.");
}
void loop(){
  uint32_t now=millis();
  IncomingCommand incoming;
  while(xQueueReceive(commandQueue,&incoming,0)==pdTRUE)applyScenario(String(incoming.text));
  while(Serial.available()){
    char c=Serial.read();
    if(c=='\n'||c=='\r'){if(commandBuffer.length()){applyScenario(commandBuffer);commandBuffer="";}}
    else if(commandBuffer.length()<24)commandBuffer+=c;
  }
  if(uint32_t(now-lastSensor)>=2000){lastSensor=now;acquire();}
  greenhouse.tick(millis());actuate();
  if(uint32_t(now-lastPublish)>=1000){lastPublish=now;drawScreen();publishState();}
  // Network reconnects run on core 0. Local control and the pump timeout remain on core 1.
  delay(2);
}
