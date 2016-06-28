/*
A Station object represents a participant in a
contest. It has a callsign, a current frequency,
a morse keyer, and a set of methods that are
called to simulate station behavior, such as
calling CQ. It also has other configuration to
make the station unique, such as a contest exchange.

Frequencies are expressed as an offset from a
base frequency. The units are hertz.
*/

var Station = function(callSign, mode) {
  // Station configuration
  this.callSign = callSign;
  this.mode = mode;
  this.state = "idle";

  // Station state (may change during contest)
  this.frequency = 0;
  this.exchange = "5nn";
  this.rfGain = 0.5;
  this.dupes = [];

  this.keyer = new Keyer(this.callSign);
  console.log("In station " + this.callSign + " creation");
  this.msgCompleteCallback = null;  // invoked when message send complete
  this.inactivityCallback = null; // used for, e.g. calling cq if no answer

  this.cqRepeatDelay = 2500;  // in ms
};

Station.prototype.init = function(context, audioSink) {
  this.context = context;
  this.audioSink = audioSink;

  this.rfGainControl = context.createGain();
  this.rfGainControl.gain.value = this.rfGain;
  this.rfGainControl.connect(audioSink);
  this.keyer.init(context, this.rfGainControl);
  console.log("In station init, keyer callsign is " + this.keyer.callSign);

};

Station.prototype.setFrequency = function(frequency) {
  this.frequency = frequency;
  console.log("Station  " + this.callSign + " set to freq "  + frequency);
};

Station.prototype.getFrequency = function() {
  return this.frequency;
};

Station.prototype.setExchange = function(exchange) {
  this.exchange = exchange;
};

Station.prototype.getCallsign = function() {
  return this.callSign;
};

Station.prototype.setRfGain = function(gain) {
  this.rfGain = gain;
};

Station.prototype.setMode = function(mode) {
  this.mode = mode;
};

Station.prototype.mute = function() {
  this.rfGainControl.gain.value = 0.0;
};

Station.prototype.unMute = function() {
  this.rfGainControl.gain.value = this.rfGain;
};

Station.prototype.stop = function() {
  console.log("Clearing inactivity timeout "  + this.inactivityCallback + " for station " + this.callSign);
  clearTimeout(this.inactivityCallback);
  this.keyer.stop();
};

Station.prototype.ifNothingHappens = function(fn, delay) {
  this.pendingAction = setTimeout(fn, delay);
  console.log("scheduled " + fn + "to happen in " + delay + "milliseconds");
}

Station.prototype.getOpDelay = function() {
  // Return a random delay between 0 and 1000 milliseconds
  ret = Math.random() * 1000.0;
  return ret;
}

/*
 Send a CQ
 */
Station.prototype.callCq = function() {
  var self = this;
  console.log("callCq for " + this.callSign);
  if (!(self.state == "idle" || self.state == "listening_after_cq" || self.state == "wait_after_tu")) {
    return;
  }
  this.msgCompleteCallback = function() {
    self.state = "listening_after_cq";
    // Set a timeout that fires if no one calls us - call CQ again
    self.inactivityCallback = setTimeout(function() {self.callCq()}, self.cqRepeatDelay);
    console.log("set inactivity callback " + self.inactivityCallback);
  }
  console.log("Station " + this.callSign + " sending cq");
    this.keyer.send("cq test " + this.callSign + " " + this.callSign, this.msgCompleteCallback);
};

/*
 Send the contest exchange
 */
Station.prototype.sendExchange = function() {
  this.send(this.exchange);
};

/*
 Send my callsign
 */
Station.prototype.sendCallSign = function() {
  this.send(this.callSign);
};

/*
 Send TU + Callsign
 */
Station.prototype.sendTU = function() {
  this.send("tu " + this.callSign);
};

Station.prototype.isCallsign = function(s) {
  return (/^[0-9a-zA-Z\/]+$/).test(s);
}

Station.prototype.isCq = function(s) {
  //m = s.match(/^cq *test *([0-9a-zA-Z\/]+)$/i);
  m = s.match(/cq *test *(([0-9a-zA-Z\/]+) *)+/i);
  return (m != null);
}

Station.prototype.isMyReportSP = function(s) {
  re = new RegExp("^ *" + this.callSign + "..*[1-5][1-9n][1-9n]$", "i");
  m = re.exec(s);
  console.log("isMyReportSP: " + (m != null));
  return m != null;
}

Station.prototype.isMyReportRun = function(s) {
  re = new RegExp("^..*[1-5][1-9n][1-9n]$", "i");
  m = re.exec(s);
  console.log("isMyReportRun: " + (m != null));
  return m != null;
}

Station.prototype.isTu = function(s) {
  return (/^.*tu.*$/i).test(s);
}

Station.prototype.isFillRequest = function(s) {
  //if (/^ *\? *$/i).test(s) {
  if (/^.*agn.*$/i.test(s)) {
    return true;
  }
  if (/^\?$/.test(s)) {
    return true;
  }
  return false;
}

Station.prototype.handleMessageRun = function(message, fromCall) {
  var self = this;
  console.log("handleMessageRun: " + this.callSign + " handling " + message + ", state is " + this.state);
  switch (this.state) {
    case "listening_after_cq":
    case "wait_after_tu":
      if (this.isCallsign(message)) {
        this.state = "sending_report";
        console.log("Canceling activityTimeout " + this.inactivityCallback);
        clearTimeout(this.inactivityCallback);
        this.keyer.send(message + " 5nn 3", function(){
          // need to use self here since this is a callback
          self.state = "wait_my_report";
        });
      }
      break;
    case "wait_my_report":
      if (this.isMyReportRun(message)) {
        this.keyer.send("tu " + this.callSign, function() {
          self.state = "wait_after_tu";
          // Set a timeout that fires if no one calls us - call CQ
          self.inactivityCallback = setTimeout(function() {self.callCq()}, self.cqRepeatDelay);
        });
      }
      break;
  }
};


Station.prototype.handleMessageSearchAndPounce = function(message, fromCall) {
  console.log("handleMessageSearchAndPounce: " + this.callSign + " handling " + message);
  console.log("THIS STATION'S CALLSIGN IS " + this.callSign);
  var self = this;
  switch (this.state) {
    case "idle":
      if (this.isCq(message)) {
        if ($.inArray(fromCall, this.dupes) != -1) {
          console.log("Station " + self.callSign + " heard CQ from " + fromCall + " but is a dupe");
        } else {
         setTimeout(function() {self.keyer.send(self.callSign)}, self.getOpDelay());
         this.state = "wait_my_report";
       }
      }
      break;
    case "wait_my_report":
      if (this.isMyReportSP(message)) {
        setTimeout(function() {self.keyer.send(fromCall + " 5NN")}, self.getOpDelay());
        this.state = "wait_confirm";
      } else {
        console.log("not my report");
        this.state = "wait_other_qso_to_end";
      }
      break;
    case "wait_confirm":
      if (this.isTu(message)) {
        this.dupes.push(fromCall);
        this.state = "idle"
      } else if (this.isFillRequest(message)) {
        setTimeout(function() {self.keyer.send(fromCall + " 5NN"), self.getOpDelay()});
        this.state = "wait_confirm";
      }
      break;
    case "wait_other_qso_to_end":
      if (this.isTu(message)) {
        console.log(this.dupes);
        if (!$.inArray(fromCall, this.dupes) != -1) {
         setTimeout(function() {self.keyer.send(self.callSign)}, self.getOpDelay());
         this.state = "wait_my_report";
       }
      }
  }
};



Station.prototype.handleMessage = function(message, fromCall) {
  //console.log("Station " + this.callSign + " (" + this.mode + " on " + this.frequency + ") handling " + message);
  //console.log("In Station.handleMessage, this is " + this);
  if (this.mode == "run") {
    this.handleMessageRun(message, fromCall);
  } else {
    this.handleMessageSearchAndPounce(message, fromCall);
  }
};
