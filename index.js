var lgtv, Service, Characteristic;
var wol = require('wake_on_lan');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-webos3', 'webos3', webos3Accessory);
}

function webos3Accessory(log, config, api) {
  this.log = log;
  this.ip = config['ip'];
  this.name = config['name'];
  this.mac = config['mac'];
  this.url = 'ws://' + this.ip + ':3000';
  this.connected = false;
  this.checkCount = 0;
  this.foregroundApp = -1;
  this.appIds = [];

  lgtv = require('lgtv2')({
    url: this.url,
    timeout: 5000,
    reconnect: 3000,
    keyFile: '/tmp/webos_key_'
  });
  
  var self = this;

  this.service = new Service.Switch(this.name, "powerService");
  this.volumeService = new Service.Lightbulb(this.name, "volumeService");

  this.service
    .getCharacteristic(Characteristic.On)
    .on('get', this.getState.bind(this))
    .on('set', this.setState.bind(this));
    
  this.volumeService = new Service.Speaker("Speaker");
  this.volumeService
    .getCharacteristic(Characteristic.Mute)
    .on('get', this.getMuteState.bind(this))
    .on('set', this.setMuteState.bind(this));
    
  this.volumeService
    .getCharacteristic(Characteristic.Volume)
    .on('get', this.getVolume.bind(this))
    .on('set', this.setVolume.bind(this));
    
  this.volumeUpDownSwitchService = new Service.StatefulProgrammableSwitch("Volume Up/Down", "WebOS3 Volume Up/Down");
  //this.volumeUpDownSwitchService
  //  .getCharacteristic(Characteristic.ProgrammableSwitchOutputState)
  //  .on('set', this.volumeUpDownState.bind(this));
    
  makeHSourceCharacteristic();
    
  this.service
    .addCharacteristic(SourceCharacteristic)
    .on('get', this.getSourcePort.bind(this))
    .on('set', this.setSourcePort.bind(this));
    
  lgtv.on('connect', function() {
    self.log('webOS3 connected to TV');
    self.connected = true;
          
    lgtv.request('ssap://com.webos.applicationManager/listLaunchPoints', function (err, res) {
        self.appIds = [];
        var launchPoints = res.launchPoints;
        var launchPoint;
        for(launchPoint in launchPoints){
            self.appIds.push(launchPoints[launchPoint].id);
        }
        //self.log(self.appIds);
    }.bind(self));
          
    lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', function (err, res) {
        var onChar = self.service.getCharacteristic(Characteristic.On);
        if(res.appId == "") {
            self.log('Turned off TV');
            self.foregroundApp = -1;
            onChar.setValue(false);
        }
        else {
            self.foregroundApp = self.appIds.indexOf(res.appId);
            self.log("switched to " + self.foregroundApp + " " + res.appId);
            if(self.foregroundApp >= 0) {
                if(onChar.getValue() === false) onChar.setValue(true);
                var sourceChar = self.service.getCharacteristic(SourceCharacteristic);
                sourceChar.setValue(self.foregroundApp);
            }
        }
    }.bind(self));
          
    lgtv.subscribe('ssap://audio/getVolume', function (err, res) {
      var volChar = self.volumeService.getCharacteristic(Characteristic.Volume);
      var targetChar = self.volumeUpDownSwitchService.getCharacteristic(Characteristic.ProgrammableSwitchOutputState);
                   
      if (!err && res.changed.indexOf('volume') !== -1) {
        self.log('volume changed', res.volume);
        var oldVol = volChar.value;
        self.log('oldVol = ' + oldVol);
        if(res.volume > oldVol) {
          self.log('Triggering volumeUp');
          targetChar.setValue(1);
          //setTimeout(function(){targetChar.setValue(0);}, 10);
        }
        else if(res.volume < oldVol) {
          self.log('Triggering volumeDown');
          targetChar.setValue(0);
          //setTimeout(function(){targetChar.setValue(0);}, 10);
        }
                   
        volChar.setValue(res.volume);
      }
      if (!err && res.changed.indexOf('muted') !== -1) {
        self.log('mute changed', res.muted);
        self.volumeService.getCharacteristic(Characteristic.Mute).setValue(res.muted);
      }
    }.bind(self));
  });
    
  lgtv.on('close', function() {
    self.log('webOS3 disconnected from TV');
    self.connected = false;
  });
    
  lgtv.on('error', function(error) {
    self.log('webOS3 error %s', error);
    self.connected = false;
    //setTimeout(lgtv.connect(this.url), 5000);
  });
    
  lgtv.on('prompt', function() {
    self.log('webOS3 prompt for confirmation');
    self.connected = false;
  });
    
  lgtv.on('connecting', function() {
    self.log('webOS3 connecting to TV');
    self.connected = false;
  });

}

webos3Accessory.prototype.getState = function(callback) {
  this.log('webOS3 TV state: %s', this.foregroundApp >= 0 ? "On" : "Off");
  return callback(null, this.foregroundApp >= 0);
}

webos3Accessory.prototype.checkWakeOnLan = function(callback) {
  if (this.connected) {
    this.checkCount = 0;
    return callback(null, true);
  } else {
    if (this.checkCount < 3) {
      this.checkCount++;
      lgtv.connect(this.url);
      setTimeout(this.checkWakeOnLan.bind(this, callback), 5000);
    } else {
      return callback(new Error('webOS3 wake timeout'));
      this.checkCount = 0;
    }
  }
}

webos3Accessory.prototype.setState = function(state, callback) {
  if (state) {
    if (!this.connected) {
      var self = this;
      wol.wake(this.mac, function(error) {
        if (error) return callback(new Error('webOS3 wake on lan error'));
        this.checkCount = 0;
        setTimeout(self.checkWakeOnLan.bind(self, callback), 5000);
      })
    } else {
      return callback(null, true);
    }
  } else {
    if (this.connected) {
      var self = this;
      lgtv.request('ssap://system/turnOff', function(err, res) {
        if (err) return callback(null, false);
        lgtv.disconnect();
        self.connected = false ;
        return callback(null, true);
      })
    } else {
      return callback(new Error('webOS3 is not connected'))
    }
  }
}


webos3Accessory.prototype.getMuteState = function(callback) {
    var self = this;
    if (self.connected) {
      lgtv.request('ssap://audio/getStatus', function (err, res) {
        if (!res || err){
          self.connected = false ;
          lgtv.disconnect();
          return callback(null, false);
        }
        self.log('webOS3 TV muted: %s', res.mute ? "Yes" : "No");   
        callback(null, !res.mute);
      });
    }else{
      callback(null, false);
    }
}

webos3Accessory.prototype.setMuteState = function(state, callback) {
    var self = this;
    if (self.connected) {
      lgtv.request('ssap://audio/setMute', {mute: !state});  
      return callback(null, true);
    }else {
      return callback(new Error('webOS3 is not connected'))
    }
}

webos3Accessory.prototype.getVolume = function(callback) {
    var self = this;
    if (self.connected) {
      lgtv.request('ssap://audio/getVolume', function (err, res) {
        if (!res || err){
          self.connected = false ;
          lgtv.disconnect();
          return callback(null, false);
        }
        self.log('webOS3 TV volume: ' + res.volume);   
        callback(null, parseInt(res.volume));
      });
    }else{
      callback(null, false);
    }
}

webos3Accessory.prototype.setVolume = function(level, callback) {
    var self = this;
    if (self.connected) {
      lgtv.request('ssap://audio/setVolume', {volume: level});  
      return callback(null, level);
     }else {
      return callback(new Error('webOS3 is not connected'))
    }
}

//webos3Accessory.prototype.volumeUpDownState = function(value, callback) {
//    this.log("volumeUpDownState is not connected");
////    var self = this;
////    lgtv.request('ssap://audio/volumeUp', function (err, res) {
////        if (!res) return callback(null, false);
////        self.log('webOS3 TV volume up');
////        callback(null, 1);
////    });
//    callback(null, value);
//}

webos3Accessory.prototype.getSourcePort = function(callback) {
    var self = this;
    if (self.connected) {
        lgtv.request('ssap://com.webos.applicationManager/getForegroundAppInfo', function (err, res) {
            if (!res) {
                callback(null, 0);
            }
            else {
                self.log('webOS3 getSourcePort: ' + res.appId);
                 
                var source = 0;
                if(res.appId == "") {
                     self.log('Turned off TV');
                }
                else {
                     source = self.appIds.indexOf(res.appId);
                     self.log(source);
                }
                callback(null, source);
            }
        }.bind(this));
    }else {
        callback(null, 0);
    }
}

webos3Accessory.prototype.setSourcePort = function(port, callback) {
    var self = this;
    if (self.connected) {
        var app = self.appIds[port];
        self.log('ssap://system.launcher/launch' + '{id: ' + app + '}');
        if(app && app != "") lgtv.request('ssap://system.launcher/launch', {id: app});
        return callback();
    }else {
        return callback(new Error('webOS3 is not connected'))
    }
}


webos3Accessory.prototype.getServices = function() {
  return [
    this.service,
    this.volumeService,
    this.volumeUpDownSwitchService
  ]
}

function makeHSourceCharacteristic() {
    
    SourceCharacteristic = function () {
        Characteristic.call(this, 'Source', '212131F4-2E14-4FF4-AE13-C97C3232498E');
        this.setProps({
                      format: Characteristic.Formats.INT,
                      unit: Characteristic.Units.NONE,
                      maxValue: 40,
                      minValue: 0,
                      minStep: 1,
                      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                      });
        this.value = this.getDefaultValue();
    };
    
    var inherits = require('util').inherits;
    inherits(SourceCharacteristic, Characteristic);
}
