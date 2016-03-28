import React, {Component} from "react";
import classNames from "classnames";
import _ from "lodash";

import BarGenerator from "../services/bar_generator.js";
import RhythmChecker from "../services/rhythm_checker.js";
import MetronomeService from "../services/metronome_service.js";
import StaveRenderer from "./stave_renderer.js";

const feedbackCanvasWidth = 500;

const phases = {
  welcome: "welcome",
  running: "running",
  feedback: "feedback",
};

export default class RhythmReadingView extends Component {

  propTypes: {
    settings: React.PropTypes.object.isRequired,
  }

  constructor(props, context) {
    super(props, context);
    this.state = {
      errorMessage: null,
      result: {success: true},
      currentRhythm: BarGenerator.generateEmptyRhythmBar(),
      currentMetronomeBeat: -1,
      phase: phases.welcome
    };
    this.beatHistory = [];
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.state.phase === phases.running && prevState.phase !== phases.running) {
      this.playMetronome();
    } else {
      console.log("not running");
    }
  }

  playMetronome() {
    const beatLength = this.props.settings.barDuration / 4;
    const delay = 100; // give the scheduler a bit of time to start the jam
    const now = performance.now();
    const startTime = now + delay;
    console.log("startTime", startTime);
    const beatAmount = 8;
    const metronomeSoundLength = 180; // ms
    // Not sure when exactly the metronome beat is anticipated by a human
    // E.g. exactly on the first millisecond? For now I'm assuming at 1/3 of
    // playing time.
    const magicPercentileOfAudibleBeat = 0.33;
    // this is the first beat of the actual bar
    this.firstBarBeatTime = startTime + 4 * beatLength + metronomeSoundLength * magicPercentileOfAudibleBeat;

    _.range(beatAmount + 1).map((beatIndex) => {
      const beatTime = startTime + beatIndex * beatLength;
      const delay = beatTime - now;

      if (beatIndex < beatAmount) {
        MetronomeService.play(delay);
      }
      setTimeout(
        () => {
          this.setState({
            currentMetronomeBeat: beatIndex < 4 ? beatIndex : -1
          });

          if (beatIndex === beatAmount) {
            const expectedTimes = this.getExpectedTimes();
            this.fixBeatHistory();
            const result = RhythmChecker.compare(expectedTimes, this.beatHistory);

            this.setState({
              phase: phases.feedback,
              result: result
            });
          }
        },
        delay
      )
    });
  }

  visualizeBeatHistory() {
    if (this.state.phase === phases.welcome) {
      return;
    }
    const canvas = this.refs.feedbackCanvas;
    const context = canvas.getContext("2d");
    if (this.state.phase !== phases.feedback) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    console.log("visualizeBeatHistory");
    console.log("beatHistory",  this.beatHistory);
    const offset = 0;
    const conversionFactor = 1000 / this.props.settings.barDuration * (feedbackCanvasWidth / 1000);

    const drawBar = (x, y, width, color) => {
      const barHeight = 10;
      const radius = barHeight / 2;

      context.fillStyle = color;
      context.fillRect(x + radius, y, width - 2 * radius, barHeight);

      context.beginPath();
      context.arc(x + radius, y + radius, radius, 0, 2 * Math.PI, false);
      context.fill();

      context.beginPath();
      // The bar will be drawn one pixel too short, so that there is a margin
      // between adjacent bars
      context.arc(x + width - radius - 1, y + radius, radius, 0, 2 * Math.PI, false);
      context.fill();

    };

    const drawBeats = (beats, y, getColor) => {
      beats.forEach((beat, index) => {
        const a = beat[0] * conversionFactor;
        const b = beat[1] * conversionFactor;
        const x = offset + a;
        const width = b - a;

        drawBar(x, y, width, getColor(index));
      });

    }
    drawBeats(this.getExpectedTimes(), 0, _.constant("gray"));
    drawBeats(this.beatHistory, 20, (index) => {
      const result = this.state.result;
      if (result.success) {
        return "green";
      }
      if (result.reason === RhythmChecker.reasons.wrongLength) {
        return "red";
      }
      if (index < result.wrongBeat) {
        return "green";
      }
      if (index === result.wrongBeat) {
        return "red";
      }
      return "gray";
    });
  }

  fixBeatHistory() {
    if (this.beatHistory.length === 0) {
      return;
    }
    // If the user pressed the very first beat it a bit too early,
    // we will round the time up to zero
    const firstBeat = this.beatHistory[0];
    if (firstBeat[0] < 0) {
      firstBeat[0] = 0;
    }

    // If the user doesn't release the key at the end of the bar,
    // we will add the up event to the beatHistory
    const lastBeat = this.beatHistory.slice(-1)[0];
    if (lastBeat.length === 1) {
      lastBeat.push(performance.now() - this.firstBarBeatTime);
    }
  }

  getExpectedTimes() {
    const durations = this.state.currentRhythm.durations;
    console.log("durations", durations);
    console.log("this.beatHistory",  this.beatHistory);
    return RhythmChecker.convertDurationsToTimes(
      this.state.currentRhythm.durations,
      this.props.settings.barDuration
    );
  }

  componentDidMount() {
    const keyup = "keyup";
    const keydown = "keydown";

    let lastSpaceEvent = keyup;
    const keyHandler = (eventType, event) => {
      const spaceCode = 32;
      if (event.keyCode !== spaceCode) {
        return;
      }
      if (this.state.phase === phases.running) {
        // ignore consecutive events of the same type
        if (lastSpaceEvent === eventType) {
          return;
        }
        // protocol beat
        const newBeatTime = performance.now() - this.firstBarBeatTime;

        lastSpaceEvent = eventType;

        if (eventType === keydown) {
          this.beatHistory.push([newBeatTime]);
        } else {
          if (newBeatTime < 0) {
            // If the user hit the key and lifted it before the first beat
            // (which is way too early), we'll ignore it.
            this.beatHistory = [];
            return;
          }
          if (this.beatHistory.length === 0) {
            // Keydown event was not registered. Assume it was pressed on
            // firstBarBeatTime.
            this.beatHistory.push([this.firstBarBeatTime]);
          }
          this.beatHistory.slice(-1)[0].push(newBeatTime);
        }
      } else {
        console.log("lastSpaceEvent",  lastSpaceEvent);
        console.log("eventType",  eventType);
        if (lastSpaceEvent === keydown && eventType === keyup) {
          lastSpaceEvent = keyup;
          return;
        }
        if (eventType === keyup) {
          console.log("start game");
          this.beatHistory = [];

          const newRhythm = this.state.result.success ?
            BarGenerator.generateRhythmBar(this.props.settings) :
            this.state.currentRhythm;

          this.setState({
            phase: phases.running,
            currentRhythm: newRhythm
          });
        }
      }
    }

    [keydown, keyup].forEach((eventType) => {
      document.addEventListener(eventType, keyHandler.bind(null, eventType));
    });
  }

  render() {
    const messageContainerClasses = classNames({
      Aligner: true,
      hide: this.state.errorMessage === null
    });

    const welcomeText =
      <h3 className={classNames({
        welcomeText: true,
        transition: true,
        heightOut: this.state.phase !== phases.welcome
      })}>
        Welcome to this rhythm training. Hit space to start.
      </h3>;

    const feedbackCanvas =
      <canvas
        ref="feedbackCanvas"
        className="feedbackCanvas transition"
        width={feedbackCanvasWidth}
        height={30}
        style={{
          marginTop: 20,
          height: this.state.phase === phases.feedback ? 30 : 0
        }} />;
    const feedbackSection =
      <div className={classNames({
        feedbackText: true,
        transition: true,
        heightOut: this.state.phase !== phases.feedback
      })}>
        <h2>
          {this.state.result.success ?
            "Yay! You nailed the rhythm!" :
            "Oh no, you didn't get the rhythm right :("
          }
        </h2>
        <h4 style={{marginTop: 0}}>
        Have a look at your performance:
        </h4>
        {feedbackCanvas}
        <h4>
          {this.state.result.success ?
            "Hit space to try a new rhythm." :
            "Hit space to try again."
          }
        </h4>
      </div>;


    console.log(this.state.currentRhythm.keys);

    const metronomeBeat =
     <h2 className={classNames({
      metronomeBeat: true,
      transition: true,
      heightOut: this.state.currentMetronomeBeat == -1,
      opacityOut: (this.state.currentMetronomeBeat + 1) % 4 === 0
     })}>
      {this.state.currentMetronomeBeat + 1}
    </h2>;

    return (
      <div className="trainer">
        <div className="Aligner">
          <div className="Aligner-item transition">
            <StaveRenderer
              keys={this.state.currentRhythm.keys}
              chordIndex={this.state.currentChordIndex}
              keySignature={"C"}
              afterRender={this.visualizeBeatHistory.bind(this)}
              staveCount={1}
            />

            <div style={{textAlign: "center"}}>
              {metronomeBeat}
              {welcomeText}
              {feedbackSection}
            </div>
          </div>
        </div>

        <div id="message-container" className={messageContainerClasses}>
          <div className="Aligner-item message Aligner">
            <h3 id="error-message"></h3>
          </div>
        </div>
      </div>
    );
  }
}
