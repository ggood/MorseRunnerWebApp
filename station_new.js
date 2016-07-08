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
  this.currentDoublers = {};

  this.keyer = new Keyer(this.callSign);
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
  self.state = "calling_cq";
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

Station.prototype.handleMessageBeginRun = function(message, fromCall) {
  console.log("handleMessageBeginRun: " + this.callSign + " handling " + message);
  switch (this.state) {
    case "calling_cq":
      console.log("Station " + fromCall + " doubled with CQing " + this.callSign);
      this.currentDoublers[fromCall] = true;
      break;
    case "listening_after_cq":
    case "wait_after_tu":
      // Clear the inactivity timeout so we don't CQ on top of the caller
      clearTimeout(this.inactivityCallback);
  }
};

Station.prototype.handleMessageBeginSearchAndPounce = function(message, fromCall) {
  console.log("handleMessageBeginSearchAndPounce: " + this.callSign + " handling " + message);
};

Station.prototype.handleMessageEndRun = function(message, fromCall) {
  var self = this;
  console.log("handleMessageEndRun: " + this.callSign + " handling " + message + ", state is " + this.state);
  switch (this.state) {
    case "calling_cq":
      // The other station's double started and ended while we were still
      // sending. Remove that station from the doublers list since we would
      // have never heard them. Ignoring QSK for now.
      delete this.currentDoublers[fromCall];
      break;
    case "listening_after_cq":
    case "wait_after_tu":
      if (!jQuery.isEmptyObject(this.currentDoublers)) {
        this.currentDoublers = {};
        this.keyer.send("?");
        break;
      }
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
    case "double":
      this.keyer.send("?", function() {
        self.state = "listening_after_cq";
        self.inactivityCallback = setTimeout(function() {self.callCq()}, self.cqRepeatDelay);
      });
      break;
  }
};


Station.prototype.handleMessageEndSearchAndPounce = function(message, fromCall) {
  console.log("handleMessageEndSearchAndPounce: " + this.callSign + " handling " + message);
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

Station.prototype.handleMessageBegin = function(message, fromCall) {
  if (this.mode == "run") {
    this.handleMessageBeginRun(message, fromCall);
  } else {
    this.handleMessageBeginSearchAndPounce(message, fromCall);
  }
};


Station.prototype.handleMessageEnd = function(message, fromCall) {
  if (this.keyer.isSending()) {
    console.log("NOT handling message end from " + fromCall + " because station " + this.callSign + " keyer is sending");
    // What to do here? If the message is a "total double" we want to ignore it
    // But if it was a partial double (meaning: the sender started while we
    // were transmitting but we stopped transmitting before they were finished)
    // we want to send a "?"
  }
  if (this.mode == "run") {
    this.handleMessageEndRun(message, fromCall);
  } else {
    this.handleMessageEndSearchAndPounce(message, fromCall);
  }
};
