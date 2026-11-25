#!/usr/bin/env node
'use strict';

//=== Read-only TE4 Builds 167-169 / demos v32-v33 singles analysis. No npm dependencies.
// node analyze-dmo.cjs "match.dmo" [--out report.html] [--fps 60] [--self-test]
const es_Fs = require('node:fs');
const es_Path = require('node:path');
const es_Crypto = require('node:crypto');
const es_Assert = require('node:assert/strict');
const es_Buffer = require('node:buffer').Buffer;
const es_FixedScale = 4294967296.0;

class CReader
{
	constructor(Buffer, Position = 0)
	{
		this.m_Buffer = Buffer;
		this.m_Position = Position;
	}
	Check(Size)
	{
		if (!Number.isInteger(Size) || Size < 0 || this.m_Position + Size > this.m_Buffer.length)
		{
			throw new Error('Unexpected EOF at byte ' + this.m_Position + ', need ' + Size);
		}
	}
	Skip(Size) { this.Check(Size); this.m_Position += Size; }
	U8() { this.Check(1); let Value = this.m_Buffer[this.m_Position]; ++this.m_Position; return Value; }
	U16() { this.Check(2); let Value = this.m_Buffer.readUInt16LE(this.m_Position); this.m_Position += 2; return Value; }
	U32() { this.Check(4); let Value = this.m_Buffer.readUInt32LE(this.m_Position); this.m_Position += 4; return Value; }
	I32() { this.Check(4); let Value = this.m_Buffer.readInt32LE(this.m_Position); this.m_Position += 4; return Value; }
	I64() { this.Check(8); let Value = this.m_Buffer.readBigInt64LE(this.m_Position); this.m_Position += 8; return Value; }
	TF() { return Number(this.I64()) / es_FixedScale; }
	Bool()
	{
		let Value = this.U8();
		es_Assert.ok(Value <= 1, 'Invalid boolean at ' + (this.m_Position - 1));
		return Value !== 0;
	}
	String()
	{
		let Length = 0;
		for (let Shift = 0; Shift <= 28; Shift += 7)
		{
			let Byte = this.U8();
			Length += (Byte & 127) * Math.pow(2, Shift);
			if ((Byte & 128) === 0)
			{
				this.Check(Length);
				let Value = this.m_Buffer.toString('utf8', this.m_Position, this.m_Position + Length);
				this.m_Position += Length;
				return Value;
			}
		}
		throw new Error('Invalid BinaryReader string length');
	}
}

function ReadHeader(Buffer)
{
	let Reader = new CReader(Buffer), Header = {};
	es_Assert.equal(Reader.String(), 'DemoTEM2-1.0g.0', 'Unsupported demo signature');
	Header.Build = Reader.U8();
	Header.SubBuild = Reader.U32();
	Header.Version = Reader.U8();
	es_Assert.ok(Header.Build >= 167 && Header.Build <= 169, 'This audited parser supports Builds 167-169 only');
	es_Assert.ok(Header.Version === 32 || Header.Version === 33, 'This audited parser supports demo versions 32-33 only');
	Header.Editor = Reader.Bool();
	if (Header.Version >= 33)
	{
		es_Assert.equal(Reader.U8(), 1, 'Unsupported commentary replay-state version');
		Reader.Skip(8 + 4 + 2 * 6); // gesture random, comment number, two cooldown SAll records
		let Players = Reader.U8();
		es_Assert.ok(Players <= 4, 'Invalid commentary player count');
		for (let i = 0; i < Players; ++i)
		{
			let Count = Reader.U8();
			es_Assert.ok(Count <= 64, 'Invalid commentary identity field count');
			Reader.Skip(Count * 4);
		}
		let Cooldowns = Reader.I32();
		es_Assert.ok(Cooldowns >= 0 && Cooldowns <= 100000, 'Invalid commentary cooldown count');
		Reader.Skip(Cooldowns * 11); // group byte, index int, cooldown SAll (6 bytes)
		Header.CommentaryEndOffset = Reader.m_Position;
	}
	Header.Surface = Reader.String();
	Header.Stadium = Reader.String();
	Header.PlayerConfig = Reader.U8();
	es_Assert.equal(Header.PlayerConfig, 0, 'Only singles with two human players are supported');
	Header.GamesPerSet = Reader.U8();
	Header.LastSetTieAt = Reader.U8();
	Header.LastSetTieMode = Reader.U8();
	Header.TiePoints = Reader.U8();
	Header.LastSetTiePoints = Reader.U8();
	Header.ControlMode = Reader.U8();
	Header.Tiredness = Reader.Bool();
	Header.NbSet = Reader.U8();
	Reader.Skip(16); // sweet spot radius / scale
	Header.GameType = Reader.U8();
	es_Assert.equal(Header.GameType, 1, 'Only regular matches are supported');
	Reader.Skip(8 + 1 + 8 + 16); // min AI service, skill mode, tiredness, CPU controls
	Reader.Skip(4 + 16 + 1 + 40 + 2 + 48 + 43 * 8 + 5 * 4); // physics, bonus skills, court bounds
	Header.CheatMode = Reader.U8();
	Reader.Skip(32 + 1); // movement multipliers, feminize
	Header.ReturnerTeam = Reader.U8();
	Header.ServerTeam = Reader.U8();
	Header.Network = Reader.Bool();
	Header.LagFrames = Reader.U8();
	es_Assert.equal(Header.Network, true, 'Only network recordings are supported');
	Reader.Skip(16 + 1 + 16);
	Header.Resumed = Reader.Bool();
	Reader.Skip(24 + 4 + 16 + 8); // volley/stress/surface, stress diff, round/coaching, crowd
	Header.WorldTour = Reader.Bool();
	Header.Davis = Reader.Bool();
	Header.Hud = Reader.String();
	Header.Names = [];
	for (let i = 0; i < 2; ++i)
	{
		Header.Names.push(Reader.String());
		Reader.String();
	}
	// Player banks / service animations are opaque. Locate the explicit final
	// header marker, then validate every subsequent block and exact EOF. Refuse
	// ambiguous markers or unsupported events instead of silently guessing offsets.
	let Marker = es_Buffer.from([0x34, 0x12, 0, 0]), Offsets = [];
	for (let Offset = Buffer.indexOf(Marker, Reader.m_Position); Offset >= 0 && Offset < 1024 * 1024; Offset = Buffer.indexOf(Marker, Offset + 1))
	{
		Offsets.push(Offset);
	}
	es_Assert.equal(Offsets.length, 1, 'Ambiguous/missing header marker');
	Header.MarkerOffset = Offsets[0];
	es_Assert.ok(Header.MarkerOffset < 1024 * 1024, 'Implausible header size');
	Header.BodyOffset = Header.MarkerOffset + 4 + 12 + 32; // random seeds, XUIDs, PSIDs
	es_Assert.ok(Header.Names.every(Name => Name && Buffer.includes(es_Buffer.from(Name))), 'Invalid team names');
	return Header;
}

function DecodeInput(Data)
{
	es_Assert.equal(Data & 1, 0, 'Special network packet inside demo inputs');
	let AmplitudeBit = (Data >> 1) & 7, Fire = (Data >> 4) & 15, Direction = (Data >> 8) & 63;
	es_Assert.ok(Fire <= 4, 'Invalid Fire=' + Fire);
	let Amplitude = AmplitudeBit ? 0.4 + (AmplitudeBit - 1) * 0.1 : 0.0;
	let Angle = Direction * Math.PI * 2.0 / 64.0;
	let Jx = Math.cos(Angle) * Amplitude, Jy = Math.sin(Angle) * Amplitude;
	// 4096-step trig table: the 64 direction indices map exactly. Numerical
	// magnitude is approximate, but the game's 1% dead band preserves exact signs.
	if (Math.abs(Jx) < 0.01) { Jx = 0.0; }
	if (Math.abs(Jy) < 0.01) { Jy = 0.0; }
	return { Raw: Data, Fire, Direction, AmplitudeBit, Jx, Jy, Sign: Math.sign(Jx), Score: Data >>> 14 };
}

function ParseFrames(Buffer, Header, FatigueCount)
{
	let Reader = new CReader(Buffer, Header.BodyOffset), Frames = [], Scores = [], Events = {}, Ended = false;
	while (Reader.m_Position < Buffer.length)
	{
		let Offset = Reader.m_Position, Inputs = [DecodeInput(Reader.U16()), DecodeInput(Reader.U16())];
		es_Assert.equal(Inputs[1].Score, 0, 'Only first human input can carry score bits at byte ' + Offset);
		let Score = Inputs[0].Score, Flags = 0, Terminal = false;
		if (Score === 3)
		{
			Flags = Reader.U8();
			if (Flags & 2) { Flags |= Reader.U8() << 8; }
			Events[Flags] = (Events[Flags] || 0) + 1;
			if (Flags & 1024)
			{
				Terminal = true;
			}
			Score = (Flags & 1) ? 0 : (Flags & 8) ? 1 : (Flags & 16) ? 2 : 0;
			if (Flags & 4096) { Reader.Skip(Header.Version >= 33 ? 11 : 9); }
			if (Flags & 8192)
			{
				let Changed = Reader.U8();
				es_Assert.ok(Changed > 0 && Changed < 4, 'Unsupported coaching players');
				for (let i = 0; i < 2; ++i)
				{
					if (Changed & (1 << i))
					{
						let Mask = Reader.I64();
						for (let k = 0; k < 2; ++k)
						{
							for (let j = 0; j < 18; ++j)
							{
								if (Mask & (1n << BigInt(j + k * 32))) { Reader.Skip(j === 17 ? 3 : 1); }
							}
						}
					}
				}
			}
			if (Flags & 16384) { Reader.Skip(2 * 18); }
			if (Flags & 32768) { throw new Error('Ball-thrower update is unsupported'); }
			if (Flags & 1) { throw new Error('Resynchronization changes point/time semantics; unsupported'); }
		}
		let Debug = 0, Service = null, ServiceWaiting = null, DebugState = null;
		if (Flags & 2048)
		{
			Debug = Reader.U8();
			es_Assert.equal(Debug & ~15, 0, 'Unknown debug payload');
			if (Debug & 1) { Reader.Skip(2 * 42 * 8); }
			if (Debug & 2)
			{
				let Scalars = Array.from({ length: 18 }, () => Reader.TF());
				Reader.Skip(2 * 3 * 8);
				Service = { PointTime: Scalars[12], Frame: Scalars[13] };
			}
			if (Debug & 4)
			{
				ServiceWaiting = { Fire: Reader.U8(), PointTime: Reader.TF(), AnimationTime: Reader.TF() };
			}
			let RandomCalls = Reader.U8(), Ball = [Reader.TF(), Reader.TF(), Reader.TF()], Players = [], StateOffset = Reader.m_Position;
			for (let i = 0; i < 2; ++i)
			{
				let X = Reader.TF(), Y = Reader.TF(), VjxRaw = Reader.I64();
				let Vjx = Number(VjxRaw) / es_FixedScale;
				es_Assert.ok(Math.abs(X) < 100000 && Math.abs(Y) < 100000 && Math.abs(Vjx) < 100000, 'Invalid recorded player state');
				Players.push({ X, Y, Vjx, VjxRaw: VjxRaw.toString() });
			}
			DebugState = { RandomCalls, Ball, Players, Offset: StateOffset };
		}
		if (Flags & 128) { Reader.Skip(FatigueCount * 24); }
		if (Flags & 4) { Reader.Skip(2 * (32 + ((Flags & 512) ? 1 : 0))); }
		if (Flags & 256) { Reader.Skip(2); }
		if (Flags & 512) { Reader.Skip(1); }
		let TimeMs = null;
		if (Score)
		{
			let LastPlayer = Reader.U8(), LastStrike = Reader.U8();
			Reader.Skip(3);
			let Difficulty = Reader.TF(), Preparation = Reader.TF(), y = Reader.TF(), LastStrikeTime = Reader.TF(), Speed = Reader.TF();
			es_Assert.ok(LastPlayer < 2 && LastStrike < 7, 'Invalid last-strike block at ' + Reader.m_Position);
			es_Assert.ok(Number.isFinite(Difficulty) && Preparation >= 0 && Preparation < 120000 && Math.abs(y) < 10000 && Speed >= 0 && Speed < 1000, 'Implausible last-strike values at ' + Offset + ': ' + JSON.stringify({ Difficulty, Preparation, y, LastStrikeTime, Speed }));
			Reader.Skip(2);
			TimeMs = Reader.TF();
			let LastSetTime = Reader.I32(), WaitTime = Reader.I32();
			Reader.Skip(12);
			es_Assert.ok(TimeMs > 0 && TimeMs < 24 * 3600000 && LastStrikeTime <= TimeMs + 1 && LastSetTime >= 0 && LastSetTime <= TimeMs + 1 && WaitTime >= 0, 'Implausible score timing');
			if (Scores.length) { es_Assert.ok(TimeMs > Scores[Scores.length - 1].TimeMs, 'Score times not strictly increasing'); }
			Scores.push({ Frame: Frames.length, Offset, Winner: Score - 1, TimeMs, LastSetTime, WaitTime, LastPlayer, LastStrike, LastStrikeTime });
		}
		if (Terminal)
		{
			es_Assert.equal(Score, 0, 'Scoring terminal record is unsupported');
			es_Assert.equal(Reader.m_Position, Buffer.length, 'Trailing bytes after ended record');
			Ended = true;
			break;
		}
		Frames.push({ Index: Frames.length, Offset, EndOffset: Reader.m_Position, Inputs, Score, Flags, Debug, Service, ServiceWaiting, DebugState, TimeMs });
	}
	es_Assert.ok(Ended, 'Missing final ended event');
	es_Assert.ok(Scores.length > 0, 'No scored points');
	return { Frames, Scores, Events, FatigueCount, EndOffset: Reader.m_Position };
}

function ReadDemo(Buffer)
{
	let Header = ReadHeader(Buffer), Candidates = [], Failures = [];
	for (let Count = 0; Count <= 2; ++Count)
	{
		try { Candidates.push(ParseFrames(Buffer, Header, Count)); }
		catch (Error) { Failures.push('fatigue=' + Count + ': ' + Error.message); }
	}
	es_Assert.equal(Candidates.length, 1, 'Expected a unique complete parse. ' + Failures.join('; '));
	return { Header, ...Candidates[0] };
}

function Quantile(Values, Fraction)
{
	if (!Values.length) { return 0.0; }
	let Sorted = Values.slice().sort((a, b) => a - b);
	return Sorted[Math.min(Sorted.length - 1, Math.floor((Sorted.length - 1) * Fraction))];
}

function Mean(Values)
{
	return Values.length ? Values.reduce((Sum, Value) => Sum + Value, 0.0) / Values.length : 0.0;
}

function Cv(Values)
{
	let Average = Mean(Values);
	return Average ? Math.sqrt(Mean(Values.map(Value => Math.pow(Value - Average, 2)))) / Average : 1.0;
}

function CalibrateTime(Demo, Fps)
{
	let Slopes = Demo.Scores.slice(1).map((Score, i) => (Score.TimeMs - Demo.Scores[i].TimeMs) / (Score.Frame - Demo.Scores[i].Frame));
	let StepMs = Quantile(Slopes, 0.5), OriginMs = Quantile(Demo.Scores.map(Score => Score.TimeMs - Score.Frame * StepMs), 0.5);
	let MaxErrorMs = Math.max(...Demo.Scores.map(Score => Math.abs(Score.TimeMs - OriginMs - Score.Frame * StepMs)));
	es_Assert.ok(StepMs >= 0.5 && StepMs <= 100 && MaxErrorMs < 0.01, 'Nonuniform frame timing: require a supported timeline');
	return { StepMs: Fps ? 1000.0 / Fps : StepMs, RecordedStepMs: StepMs, OriginMs, MaxErrorMs, NominalFps: Math.round(1000.0 / StepMs), Override: !!Fps };
}

function ScoreText(State)
{
	let Values = ['0', '15', '30', '40'];
	let PointText = State.TieTarget > 0
		? State.Points.join('-')
		: State.Points[0] >= 3 && State.Points[1] >= 3
			? State.Points[0] === State.Points[1] ? '40-40' : State.Points[0] > State.Points[1] ? 'AV-40' : '40-AV'
			: State.Points.map(Value => Values[Value]).join('-');
	return 'S' + (State.Completed.length + 1) + ' ' + State.Games.join('-') + ' / ' + PointText;
}

function AdvanceScore(State, Winner, Header)
{
	++State.Points[Winner];
	if (State.TieTarget > 0)
	{
		if (State.Points[Winner] >= State.TieTarget && State.Points[Winner] - State.Points[Winner ^ 1] >= 2)
		{
			++State.Games[Winner];
			State.Completed.push(State.Games.slice());
			State.Games = [0, 0];
			State.Points = [0, 0];
			State.Server = State.TieFirstServer ^ 1;
			// A set won in a tiebreak can also lead straight into the deciding match tiebreak.
			State.TieTarget = State.Completed.length === Header.NbSet * 2 - 2 && Header.LastSetTieAt === 0 ? Header.LastSetTiePoints : 0;
			State.TieFirstServer = State.Server;
		}
		else
		{
			let Played = State.Points[0] + State.Points[1];
			State.Server = State.TieFirstServer ^ (Math.floor((Played + 1) / 2) & 1);
		}
	}
	else if (State.Points[Winner] >= 4 && State.Points[Winner] - State.Points[Winner ^ 1] >= 2)
	{
		++State.Games[Winner];
		State.Points = [0, 0];
		State.Server ^= 1;
		let FinalSetIndex = Header.NbSet * 2 - 2, IsFinalSet = State.Completed.length === FinalSetIndex;
		let TieAt = IsFinalSet ? Header.LastSetTieAt : Header.GamesPerSet;
		let TieAllowed = Header.LastSetTieMode === 1 || (Header.LastSetTieMode !== 3 && (!IsFinalSet || State.Completed.length === 0));
		if (State.Games[Winner] >= Header.GamesPerSet && State.Games[Winner] - State.Games[Winner ^ 1] >= 2)
		{
			State.Completed.push(State.Games.slice());
			State.Games = [0, 0];
			if (State.Completed.length === FinalSetIndex && Header.LastSetTieAt === 0)
			{
				State.TieTarget = Header.LastSetTiePoints;
				State.TieFirstServer = State.Server;
			}
		}
		else if (TieAllowed && State.Games[0] === State.Games[1] && State.Games[0] >= TieAt)
		{
			State.TieTarget = IsFinalSet ? Header.LastSetTiePoints : Header.TiePoints;
			State.TieFirstServer = State.Server;
		}
	}
}

function BuildPoints(Demo)
{
	es_Assert.equal(Demo.Header.Resumed, false, 'Resumed matches need an explicit initial score/point number');
	let FinalTieFromStart = Demo.Header.NbSet === 1 && Demo.Header.LastSetTieAt === 0;
	let State = { Points: [0, 0], Games: [0, 0], Completed: [], Server: Demo.Header.ServerTeam, TieTarget: FinalTieFromStart ? Demo.Header.LastSetTiePoints : 0, TieFirstServer: Demo.Header.ServerTeam }, Points = [], Start = 0;
	for (let i = 0; i <= Demo.Scores.length; ++i)
	{
		let Score = Demo.Scores[i], End = Score ? Score.Frame : Demo.Frames.length - 1;
		let Services = Demo.Frames.slice(Start, End + 1).filter(Frame => Frame.Service).map(Frame => ({ Hit: Frame.Index, Start: Math.round(Frame.Index - Frame.Service.Frame + 1) }));
		let Point = { Number: i + 1, BoundaryStart: Start, Start: Services.length ? Math.max(Start, Services[0].Start) : Start, End, Score: ScoreText(State), Server: State.Server, Services, Winner: Score ? Score.Winner : null };
		Points.push(Point);
		for (let j = Start; j <= End; ++j) { Demo.Frames[j].Point = Point; }
		if (Score) { AdvanceScore(State, Score.Winner, Demo.Header); }
		Start = End + 1;
		if (Start >= Demo.Frames.length) { break; }
	}
	let ScoreParts = State.Completed.map(Set => Set.join('-'));
	if (State.Games[0] + State.Games[1] > 0 || !ScoreParts.length)
	{
		ScoreParts.push(State.Games.join('-'));
	}
	return { Points, FinalScore: ScoreParts.join(' '), State };
}

function InputCutAnalysis(Demo, Timing, Player, Aiming)
{
	let Segments = [], Current = null, Seconds = Timing.StepMs / 1000.0;
	for (let Frame of Demo.Frames)
	{
		let Point = Frame.Point, Input = Frame.Inputs[Player];
		let InService = Point.Server === Player && Point.Services.some(Service => Frame.Index >= Service.Start && Frame.Index <= Service.Hit);
		let Eligible = Frame.Index >= Point.Start && !Frame.Score && !InService && (Aiming ? Input.Fire >= 1 && Input.Fire <= 3 : Input.Fire === 0);
		if (!Eligible || !Current || Current.Point !== Point.Number)
		{
			if (Current)
			{
				Segments.push(Current);
			}
			Current = Eligible ? { Start: Frame.Index, Point: Point.Number, Signs: [] } : null;
		}
		if (Current)
		{
			Current.Signs.push(Input.Sign);
		}
	}
	if (Current)
	{
		Segments.push(Current);
	}
	let Gaps = [], ActiveSeconds = [0.0, 0.0];
	for (let Segment of Segments)
	{
		let Blocks = Runs(Segment.Signs);
		for (let Sign of Segment.Signs)
		{
			if (Sign)
			{
				ActiveSeconds[Sign > 0 ? 1 : 0] += Seconds;
			}
		}
		for (let i = 1; i < Blocks.length - 1; ++i)
		{
			let Block = Blocks[i], Before = Blocks[i - 1], After = Blocks[i + 1];
			if (Block.Sign || !Before.Sign || Before.Sign !== After.Sign || Block.Length * Seconds > 0.085)
			{
				continue;
			}
			let Start = Segment.Start + Block.Start, End = Start + Block.Length - 1, Recorded = Demo.Frames[Start - 1].DebugState;
			Gaps.push({ Start, End, Point: Segment.Point, Sign: Before.Sign, Frames: Block.Length, BeforeFrames: Before.Length, AfterFrames: After.Length, CutMagnitude: Recorded ? Math.abs(Recorded.Players[Player].Vjx) : null });
		}
	}
	return {
		Mode: Aiming ? 'aim' : 'move', Gaps,
		Directions: [-1, 1].map((Sign, i) =>
		{
			let Own = Gaps.filter(Gap => Gap.Sign === Sign);
			return { Sign, Count: Own.length, ActiveSeconds: ActiveSeconds[i], Per100Seconds: ActiveSeconds[i] ? Own.length / ActiveSeconds[i] * 100.0 : 0.0, Histogram: [1, 2, 3, 4, 5].map(Frames => Own.filter(Gap => Gap.Frames === Frames).length) };
		})
	};
}

function IsLongPreparation(Episode)
{
	return Episode.Context !== 'service' && Episode.Duration > 0.5 + 1e-8;
}

function RecordedAnalysis(Demo, Timing, Analysis)
{
	let Count = Demo.Frames.filter(Frame => Frame.DebugState).length, Summary = [], Windows = [];
	for (let Player = 0; Player < 2; ++Player)
	{
		let Own = Analysis.Episodes.filter(Episode => Episode.Player === Player && Episode.Context !== 'service'), Long = Own.filter(IsLongPreparation);
		let Peaks = Own.map(Episode =>
		{
			let Values = Demo.Frames.slice(Episode.Start, Episode.End + 1).filter(Frame => Frame.DebugState).map(Frame => Math.abs(Frame.DebugState.Players[Player].Vjx));
			return { Episode: Episode.Id, Value: Values.length ? Math.max(...Values) : null };
		});
		let NonzeroPeaks = Peaks.filter(Peak => Peak.Value > 0).sort((a, b) => b.Value - a.Value), Filtered = NonzeroPeaks.filter(Peak => Peak.Value <= 550.0), Top = Filtered.slice(0, Math.ceil(Filtered.length * 0.1));
		let Aim = InputCutAnalysis(Demo, Timing, Player, true), Move = InputCutAnalysis(Demo, Timing, Player, false);
		let CutValues = Aim.Gaps.filter(Gap => Gap.CutMagnitude !== null).map(Gap => Gap.CutMagnitude);
		let ReleaseBins = [{ Min: 200.0, Max: 290.0, Frames: 0, Neutral: 0 }, { Min: 290.0, Max: 310.0, Frames: 0, Neutral: 0 }, { Min: 310.0, Max: 400.0, Frames: 0, Neutral: 0 }];
		let RecurrenceErrors = [];
		for (let i = 1; i < Demo.Frames.length; ++i)
		{
			let Frame = Demo.Frames[i], Previous = Demo.Frames[i - 1], Input = Frame.Inputs[Player], Point = Frame.Point;
			if (!Frame.DebugState || !Previous.DebugState || Input.Fire < 1 || Input.Fire > 3 || Previous.Inputs[Player].Fire < 1 || Previous.Inputs[Player].Fire > 3 || Previous.Point !== Point || Frame.Score || i < Point.Start || (Point.Server === Player && Point.Services.some(Service => i >= Service.Start && i <= Service.Hit)))
			{
				continue;
			}
			let Before = Previous.DebugState.Players[Player], Current = Frame.DebugState.Players[Player];
			for (let Bin of ReleaseBins)
			{
				if (Math.abs(Before.Vjx) >= Bin.Min && Math.abs(Before.Vjx) < Bin.Max)
				{
					++Bin.Frames;
					if (!Input.Sign)
					{
						++Bin.Neutral;
					}
				}
			}
			if (Math.abs(Before.Vjx) > 100.0 && Math.abs(Current.Vjx) > 100.0 && (!Input.Sign || Input.Sign * Before.Vjx > 0))
			{
				let Scale = 720000.0 / (Math.abs(Before.Y / 2.0) + 400.0) * Timing.StepMs / 1000.0;
				let Expected = Input.Sign ? Before.Vjx + Input.Sign * Scale : Before.Vjx * Math.pow(0.2, Timing.StepMs / 1000.0);
				RecurrenceErrors.push(Math.abs(Expected - Current.Vjx));
			}
		}
		for (let Bin of ReleaseBins)
		{
			Bin.NeutralPercent = Bin.Frames ? 100.0 * Bin.Neutral / Bin.Frames : null;
		}
		for (let Candidate of Analysis.Candidates.filter(Value => Value.Player === Player && Value.Context !== 'service'))
		{
			let Values = Demo.Frames.slice(Candidate.Start, Candidate.End + 1).filter(Frame => Frame.DebugState).map(Frame => Math.abs(Frame.DebugState.Players[Player].Vjx));
			if (Values.length !== Candidate.End - Candidate.Start + 1)
			{
				continue;
			}
			let Min = Math.min(...Values), Max = Math.max(...Values), Median = Quantile(Values, 0.5);
			let Plateau = Candidate.Pauses >= 3 && Max - Min <= 60.0 && Median >= 180.0 && Max < 550.0;
			Candidate.Recorded = { Min, Max, Median, Plateau };
			if (Plateau)
			{
				Windows.push({ Player, Point: Candidate.Point, Start: Candidate.Start, End: Candidate.End, Duration: Candidate.Duration, Pauses: Candidate.Pauses, Min, Max, Median });
			}
		}
		Summary.push({ Player, Name: Demo.Header.Names[Player], LongEpisodes: Long.length, LongWithShortGaps: Long.filter(Episode => Episode.Metrics.ShortPauses > 0).length, LongWithRepeatedGaps: Long.filter(Episode => Episode.Metrics.ShortPauses >= 2).length, RecordedPlateaus: Windows.filter(Window => Window.Player === Player).length, MaxAbs: NonzeroPeaks.length ? NonzeroPeaks[0].Value : null, FilteredCount: Filtered.length, FilteredMax: Filtered.length ? Filtered[0].Value : null, Top10Count: Top.length, Top10Mean: Top.length ? Mean(Top.map(Peak => Peak.Value)) : null, CutMagnitudeP10: Quantile(CutValues, 0.1), CutMagnitudeMedian: Quantile(CutValues, 0.5), CutMagnitudeP90: Quantile(CutValues, 0.9), ReleaseBins, Recurrence: { Frames: RecurrenceErrors.length, Within001cm: RecurrenceErrors.filter(Error => Error < 0.01).length, MedianErrorCm: Quantile(RecurrenceErrors, 0.5), P90ErrorCm: Quantile(RecurrenceErrors, 0.9) }, Aim, Move });
	}
	return { Frames: Count, TotalFrames: Demo.Frames.length, Coverage: Count / Demo.Frames.length, Summary, Windows };
}

function SimulateAim(Signs, StepSeconds, Baseline = 1189, IgnoredFrames = 0)
{
	let Value = 0.0, Scale = 720000.0 / (Math.abs(Baseline / 2.0) + 400.0) * StepSeconds, Decay = Math.pow(0.2, StepSeconds), Values = [];
	for (let Sign of Signs)
	{
		if (!Sign) { Value *= Decay; }
		else if (Sign * Value > 0) { Value += Sign * Scale; }
		else { Value = Sign * (100.0 + Scale * IgnoredFrames); }
		Values.push(Value);
	}
	return Values;
}

function VirtualAimSummary(Demo, Timing, Episodes)
{
	let RallyIgnoredFrames = Demo.Header.LagFrames ? Math.max(0, Math.min(15, Math.trunc((Demo.Header.LagFrames * 75 - 66) / 100) - 2)) : 0;
	let Summary = [0, 1].map(Player => ({ Player, Name: Demo.Header.Names[Player], MaxAbs: 0.0, SignedPeak: 0.0, Min: 0.0, Max: 0.0, Frame: null, Point: null, Score: null, Episode: null }));
	for (let Episode of Episodes)
	{
		let IgnoredFrames = Episode.Context === 'service' ? Math.min(10, Demo.Header.LagFrames) : RallyIgnoredFrames;
		Episode.VirtualAim = SimulateAim(Episode.Signs, Timing.StepMs / 1000.0, 1189, IgnoredFrames);
		if (Episode.Context === 'service')
		{
			continue;
		}
		let Own = Summary[Episode.Player];
		for (let i = 0; i < Episode.VirtualAim.length; ++i)
		{
			let Value = Episode.VirtualAim[i];
			Own.Min = Math.min(Own.Min, Value);
			Own.Max = Math.max(Own.Max, Value);
			if (Math.abs(Value) > Own.MaxAbs)
			{
				Own.MaxAbs = Math.abs(Value);
				Own.SignedPeak = Value;
				Own.Frame = Episode.Start + i;
				Own.Point = Episode.Point;
				Own.Score = Episode.Score;
				Own.Episode = Episode.Id;
			}
		}
	}
	return { Baseline: 1189, StepSeconds: Timing.StepMs / 1000.0, Scale: 720000.0 / 994.5 * Timing.StepMs / 1000.0, Decay: Math.pow(0.2, Timing.StepMs / 1000.0), RallyIgnoredFrames, Summary };
}

function Runs(Signs)
{
	let Result = [];
	for (let i = 0; i < Signs.length; ++i)
	{
		let Last = Result[Result.length - 1];
		if (!Last || Last.Sign !== Signs[i]) { Result.push({ Sign: Signs[i], Start: i, Length: 1 }); }
		else { ++Last.Length; }
	}
	return Result;
}

function Periodicity(Signs)
{
	let Average = Mean(Signs), Best = 0.0, Lag = 0;
	if (Math.abs(Average) === 1 || Signs.every(Value => Value === 0)) { return { Correlation: 0, Lag: 0 }; }
	// Centered autocorrelation: a long constant hold cannot get a good score merely
	// from agreement with itself. At least 2.5 cycles must fit inside the window.
	for (let Offset = 2; Offset <= Math.min(20, Math.floor(Signs.length / 2.5)); ++Offset)
	{
		let Numerator = 0.0, Left = 0.0, Right = 0.0;
		for (let i = Offset; i < Signs.length; ++i)
		{
			let a = Signs[i] - Average, b = Signs[i - Offset] - Average;
			Numerator += a * b;
			Left += a * a;
			Right += b * b;
		}
		let Correlation = Left && Right ? Numerator / Math.sqrt(Left * Right) : 0.0;
		if (Correlation > Best) { Best = Correlation; Lag = Offset; }
	}
	return { Correlation: Best, Lag };
}

function WindowMetrics(Signs, Models, StepSeconds)
{
	let Blocks = Runs(Signs), Active = Signs.filter(Sign => Sign !== 0), NonzeroSigns = new Set(Active);
	let Pauses = Blocks.filter((Block, i) => !Block.Sign && i > 0 && i < Blocks.length - 1 && Blocks[i - 1].Sign === Blocks[i + 1].Sign);
	let ShortPauses = Pauses.filter(Block => Block.Length * StepSeconds <= 0.085);
	let Reversals = 0;
	for (let i = 1; i < Active.length; ++i) { if (Active[i] !== Active[i - 1]) { ++Reversals; } }
	let CycleStarts = Blocks.filter(Block => Block.Sign !== 0).map(Block => Block.Start), Periods = CycleStarts.slice(1).map((Value, i) => Value - CycleStarts[i]);
	let ActiveFraction = Active.length / Signs.length, ToggleCount = Blocks.length - 1;
	let Periodic = Periodicity(Signs), ModelFeatures = Models.map(Values =>
	{
		let Median = Quantile(Values, 0.5), Spread = Quantile(Values, 0.9) - Quantile(Values, 0.1), Half = Math.floor(Values.length / 2);
		let Drift = Math.abs(Mean(Values.slice(Half)) - Mean(Values.slice(0, Half)));
		let Cuts = Blocks.filter((Block, i) => !Block.Sign && i > 0).map(Block => Values[Block.Start - 1]);
		let CutSpread = Cuts.length >= 3 ? Math.max(...Cuts) - Math.min(...Cuts) : Infinity;
		return { Median, Spread, RelativeSpread: Spread / Math.max(100.0, Math.abs(Median)), RelativeDrift: Drift / Math.max(100.0, Math.abs(Median)), CutSpread };
	});
	let PlateauVotes = ModelFeatures.filter(Model => Math.abs(Model.Median) >= 180.0 && Model.RelativeSpread <= 0.18 && Model.RelativeDrift <= 0.08).length;
	let ThresholdVotes = ModelFeatures.filter(Model => Model.CutSpread <= 35.0).length;
	let Methods = [], Strength = 0;
	if (NonzeroSigns.size === 1 && ShortPauses.length >= 2 && ToggleCount >= 4 && ActiveFraction >= 0.15 && ActiveFraction <= 0.92)
	{
		Methods.push('short neutral gaps'); Strength = 1;
	}
	if (NonzeroSigns.size === 1 && Pauses.length >= 3 && Periods.length >= 3 && Periodic.Correlation >= 0.85 && Cv(Periods) <= 0.2)
	{
		Methods.push('repeating input cadence'); Strength = Math.max(Strength, 2);
	}
	if (NonzeroSigns.size === 1 && Pauses.length >= 2 && PlateauVotes >= 2)
	{
		Methods.push('simulated aim plateau'); Strength = Math.max(Strength, 2);
		if (ThresholdVotes >= 2 && Pauses.length >= 3) { Methods.push('repeated simulated release threshold'); Strength = 3; }
	}
	if (Reversals >= 4)
	{
		Methods.push('rapid direction reversals'); Strength = Math.max(Strength, Periodic.Correlation >= 0.85 ? 2 : 1);
	}
	return { ToggleCount, Reversals, Pauses: Pauses.length, ShortPauses: ShortPauses.length, ActiveFraction, Periodicity: Periodic.Correlation, PeriodFrames: Periodic.Lag, CycleCv: Cv(Periods), PlateauVotes, ThresholdVotes, ModelMedian: ModelFeatures[1].Median, ModelRelativeSpread: ModelFeatures[1].RelativeSpread, Methods, Strength };
}

function Analyze(Demo, Timing, MinSeconds = 0.5)
{
	let PointInfo = BuildPoints(Demo), Episodes = [], Candidates = [], StepSeconds = Timing.StepMs / 1000.0;
	let MinFrames = Math.ceil(MinSeconds / StepSeconds - 1e-8), WindowSizes = [...new Set([MinFrames, Math.ceil(0.75 / StepSeconds), Math.ceil(1.0 / StepSeconds)])];
	for (let Player = 0; Player < 2; ++Player)
	{
		let Current = null;
		for (let Frame of Demo.Frames)
		{
			let Input = Frame.Inputs[Player], Point = Frame.Point;
			let InService = Point.Server === Player && Point.Services.some(Service => Frame.Index >= Service.Start && Frame.Index <= Service.Hit);
			let Eligible = Input.Fire >= 1 && Input.Fire <= 3 && Frame.Index >= Point.Start && !Frame.Score;
			let Context = InService ? 'service' : Point.Services.length && Frame.Index < Point.Services[0].Hit ? 'before return' : 'rally';
			if (!Eligible || !Current || Current.Point !== Point.Number || Current.Context !== Context)
			{
				if (Current) { Episodes.push(Current); Current = null; }
				if (Eligible) { Current = { Player, Point: Point.Number, Score: Point.Score, Context, Start: Frame.Index, PointStart: Point.Start, Inputs: [], Signs: [] }; }
			}
			if (Current) { Current.Inputs.push(Input); Current.Signs.push(Input.Sign); }
		}
		if (Current) { Episodes.push(Current); }
	}
	for (let i = 0; i < Episodes.length; ++i)
	{
		let Episode = Episodes[i];
		Episode.Id = i;
		Episode.End = Episode.Start + Episode.Signs.length - 1;
		Episode.Duration = Episode.Signs.length * StepSeconds;
		Episode.Models = [900, 1189, 1600].map(Baseline => SimulateAim(Episode.Signs, StepSeconds, Baseline));
		Episode.Metrics = WindowMetrics(Episode.Signs, Episode.Models, StepSeconds);
		let Windows = [];
		for (let Size of WindowSizes)
		{
			if (Size > Episode.Signs.length) { continue; }
			for (let Start = 0; Start <= Episode.Signs.length - Size; ++Start)
			{
				let Metrics = WindowMetrics(Episode.Signs.slice(Start, Start + Size), Episode.Models.map(Model => Model.slice(Start, Start + Size)), StepSeconds);
				if (Metrics.Strength)
				{
					Windows.push({ Start: Episode.Start + Start, End: Episode.Start + Start + Size - 1, Duration: Size * StepSeconds, ...Metrics });
				}
			}
		}
		// One review entry per continuous Fire episode: retain the best exact window,
		// rather than inflating evidence by counting overlapping sliding windows.
		if (Windows.length)
		{
			Windows.sort((a, b) => b.Strength - a.Strength || b.PlateauVotes - a.PlateauVotes || b.Pauses - a.Pauses || a.Duration - b.Duration || b.Periodicity - a.Periodicity);
			let Best = Windows[0];
			Candidates.push({ Episode: i, Player: Episode.Player, Point: Episode.Point, Score: Episode.Score, Context: Episode.Context, ...Best });
		}
	}
	// Cross-episode recurrence of the APPROXIMATE target is descriptive evidence.
	// It only counts independent episodes already meeting a model plateau test.
	for (let Candidate of Candidates)
	{
		Candidate.TargetRecurrences = Candidates.filter(Other => Other.Player === Candidate.Player && Other.Episode !== Candidate.Episode && Other.PlateauVotes >= 2 && Candidate.PlateauVotes >= 2 && Math.abs(Math.abs(Other.ModelMedian) - Math.abs(Candidate.ModelMedian)) <= 25.0).length;
	}
	Candidates.sort((a, b) => b.Strength - a.Strength || b.TargetRecurrences - a.TargetRecurrences || b.Pauses - a.Pauses || b.Periodicity - a.Periodicity || a.Start - b.Start);
	let Summary = [0, 1].map(Player =>
	{
		let Own = Episodes.filter(Episode => Episode.Player === Player && Episode.Context !== 'service'), Long = Own.filter(Episode => Episode.Duration >= MinSeconds), OwnCandidates = Candidates.filter(Candidate => Candidate.Player === Player && Candidate.Context !== 'service');
		let Seconds = Own.reduce((Sum, Episode) => Sum + Episode.Duration, 0.0);
		return { Player, Name: Demo.Header.Names[Player], Episodes: Own.length, LongEpisodes: Long.length, FireSeconds: Seconds, ToggleCount: Own.reduce((Sum, Episode) => Sum + Episode.Metrics.ToggleCount, 0), MaxTogglesPerEpisode: Math.max(0, ...Own.map(Episode => Episode.Metrics.ToggleCount)), Candidates: OwnCandidates.length, Medium: OwnCandidates.filter(Candidate => Candidate.Strength >= 2).length, High: OwnCandidates.filter(Candidate => Candidate.Strength >= 3).length, ToggleP95: Quantile(Long.map(Episode => Episode.Metrics.ToggleCount), 0.95), ServiceCandidates: Candidates.filter(Candidate => Candidate.Player === Player && Candidate.Context === 'service').length };
	});
	let VirtualAim = VirtualAimSummary(Demo, Timing, Episodes);
	let Result = { ...PointInfo, Episodes, Candidates, Summary, MinFrames, MinSeconds, WindowSizes, VirtualAim };
	Result.Recorded = RecordedAnalysis(Demo, Timing, Result);
	return Result;
}

function EscapeHtml(Value)
{
	return String(Value).replace(/[&<>"']/g, Char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[Char]));
}

function TimeText(Seconds)
{
	return Math.floor(Seconds / 60).toString().padStart(2, '0') + ':' + (Seconds % 60).toFixed(3).padStart(6, '0');
}

function FocusCharts(Demo, Timing, Analysis)
{
	let Width = 1120, Left = 62, Right = 1090;
	let Available = Analysis.Candidates.filter(Candidate => Candidate.Context !== 'service');
	let Selected = Available.slice(0, 8);
	for (let Candidate of Available.filter(Value => Value.Recorded && Value.Recorded.Plateau).slice().sort((a, b) => a.Start - b.Start).slice(0, 4))
	{
		if (!Selected.includes(Candidate))
		{
			Selected.push(Candidate);
		}
	}
	return Selected.sort((a, b) => a.Point - b.Point || a.Start - b.Start).map(Candidate =>
	{
		let Episode = Analysis.Episodes[Candidate.Episode], Count = Episode.Inputs.length, Height = Analysis.Recorded.Coverage >= 0.99 ? 365 : 220;
		let x = Index => Left + (Index + 0.5) / Count * (Right - Left), y = Value => 92.0 - Value * 46.0;
		let Parts = ['<article id="jx-episode-' + Episode.Id + '"><h3>Point ' + Candidate.Point + ' — ' + EscapeHtml(Demo.Header.Names[Candidate.Player]) + '</h3>'];
		Parts.push('<p class="muted">' + EscapeHtml(Episode.Score) + ' · Match frames ' + Episode.Start + '–' + Episode.End + ' · ' + TimeText(Episode.Start * Timing.StepMs / 1000.0) + '–' + TimeText((Episode.End + 1) * Timing.StepMs / 1000.0) + ' · ' + Count + ' frames with m_Fire active</p>');
		Parts.push('<svg class="chart" viewBox="0 0 ' + Width + ' ' + Height + '" role="img" aria-label="m_Jx for ' + EscapeHtml(Demo.Header.Names[Candidate.Player]) + ', point ' + Candidate.Point + ', one value per frame"><title>m_Jx by frame, point ' + Candidate.Point + '</title>');
		let BandLeft = Left + (Candidate.Start - Episode.Start) / Count * (Right - Left), BandWidth = (Candidate.End - Candidate.Start + 1) / Count * (Right - Left);
		Parts.push('<rect x="' + BandLeft + '" y="28" width="' + BandWidth + '" height="130" fill="#ffcb70" opacity=".16"/>');
		for (let Value of [-1, 0, 1])
		{
			Parts.push('<line x1="' + Left + '" x2="' + Right + '" y1="' + y(Value) + '" y2="' + y(Value) + '" stroke="#30475e"/><text x="15" y="' + (y(Value) + 4) + '" fill="#a8bbcd" font-size="12">' + Value + '</text>');
		}
		let Path = '';
		for (let i = 0; i < Count; ++i)
		{
			let Input = Episode.Inputs[i], XStart = Left + i / Count * (Right - Left), XEnd = Left + (i + 1) / Count * (Right - Left), Y = y(Input.Jx);
			Path += (i ? 'V' : 'M' + XStart + ' ') + Y + 'H' + XEnd;
			Parts.push('<line x1="' + x(i) + '" x2="' + x(i) + '" y1="' + y(0) + '" y2="' + Y + '" stroke="#67c5ff" opacity=".2"/>');
			let Recorded = Demo.Frames[Episode.Start + i].DebugState;
			let AimLabel = Recorded ? 'recorded m_Vjx = ' + Recorded.Players[Candidate.Player].Vjx.toFixed(2) + ' cm, y = ' + Recorded.Players[Candidate.Player].Y.toFixed(2) + ' cm' : 'simulated m_Vjx = ' + Episode.VirtualAim[i].toFixed(2) + ' cm';
			Parts.push('<circle cx="' + x(i) + '" cy="' + Y + '" r="2.3" fill="#67c5ff"><title>Preparation frame ' + i + ' / match frame ' + (Episode.Start + i) + ' · m_Jx ≈ ' + Input.Jx.toFixed(6) + ', m_Fire = ' + Input.Fire + ', ' + AimLabel + '</title></circle>');
			Parts.push('<rect x="' + XStart + '" y="164" width="' + ((Right - Left) / Count) + '" height="10" fill="' + ['', '#5bb2dc', '#bd9deb', '#8be0ba'][Input.Fire] + '"/>');
			if (i % 10 === 0 || i === Count - 1)
			{
				if (i === Count - 1 && i % 10 < 4 && i > 9)
				{
					continue;
				}
				Parts.push('<line x1="' + x(i) + '" x2="' + x(i) + '" y1="145" y2="151" stroke="#a8bbcd"/><text x="' + x(i) + '" y="194" text-anchor="middle" fill="#a8bbcd" font-size="12">' + i + '</text>');
			}
		}
		Parts.push('<path d="' + Path + '" fill="none" stroke="#67c5ff" stroke-width="1.5"/><text x="15" y="173" fill="#a8bbcd" font-size="11">Fire</text><text x="' + ((Left + Right) / 2) + '" y="215" text-anchor="middle" fill="#a8bbcd" font-size="12">Frame within preparation (0 = match frame ' + Episode.Start + ')</text></svg>');
		if (Analysis.Recorded.Coverage >= 0.99)
		{
			let Actual = Demo.Frames.slice(Episode.Start, Episode.End + 1).map(Frame => Frame.DebugState?.Players[Candidate.Player].Vjx);
			let Bound = Math.max(550.0, Math.ceil(Math.max(...Actual.filter(Number.isFinite).map(Value => Math.abs(Value))) / 100.0) * 100.0), ActualPath = '';
			let Plot = '<text x="' + Left + '" y="239" fill="#8be0ba" font-size="12">Recorded m_Vjx (cm) · Dotted lines at ±411.5 cm</text>';
			for (let Value of [-411.5, 0, 411.5])
			{
				let Y = 297.0 - Value / Bound * 45.0;
				Plot += '<line x1="' + Left + '" x2="' + Right + '" y1="' + Y + '" y2="' + Y + '" stroke="#49627c"' + (Value ? ' stroke-dasharray="4 4"' : '') + '/><text x="5" y="' + (Y + 4) + '" fill="#a8bbcd" font-size="11">' + Value + '</text>';
			}
			for (let i = 0; i < Actual.length; ++i)
			{
				if (Actual[i] !== undefined)
				{
					ActualPath += (Actual[i - 1] === undefined ? 'M' : 'L') + x(i) + ' ' + (297.0 - Actual[i] / Bound * 45.0);
				}
			}
			Plot += '<path d="' + ActualPath + '" fill="none" stroke="#8be0ba" stroke-width="1.7"/>';
			Parts[Parts.length - 1] = Parts[Parts.length - 1].replace('</svg>', Plot + '</svg>');
		}
		let Pattern = Runs(Episode.Signs).map(Block => (Block.Sign < 0 ? 'L' : Block.Sign > 0 ? 'R' : '·') + '×' + Block.Length).join('  ');
		let MaxAbs = Math.max(...Episode.VirtualAim.map(Value => Math.abs(Value)));
		Parts.push('<p class="sequence">' + Pattern + '</p><p class="muted">L = left, R = right, · = neutral. The number after × is the run length in frames. Amber marks the flagged window. Peak simulated |m_Vjx| for this preparation was ' + MaxAbs.toFixed(2) + ' cm.</p></article>');
		return Parts.join('');
	}).join('<hr>');
}

function WriteReport(Filename, Source, Buffer, Demo, Timing, Analysis, Checks)
{
	let Raw = es_Buffer.alloc(Demo.Frames.length * 4), States = es_Buffer.alloc(Demo.Frames.length * 48), StatePresent = es_Buffer.alloc(Demo.Frames.length);
	for (let Frame of Demo.Frames)
	{
		Raw.writeUInt16LE(Frame.Inputs[0].Raw, Frame.Index * 4);
		Raw.writeUInt16LE(Frame.Inputs[1].Raw, Frame.Index * 4 + 2);
		if (Frame.DebugState)
		{
			StatePresent[Frame.Index] = 1;
			for (let i = 0; i < 2; ++i)
			{
				let Player = Frame.DebugState.Players[i], Offset = Frame.Index * 48 + i * 24;
				States.writeDoubleLE(Player.X, Offset);
				States.writeDoubleLE(Player.Y, Offset + 8);
				States.writeDoubleLE(Player.Vjx, Offset + 16);
			}
		}
	}
	const es_RepeatedGapEpisodes = Analysis.Episodes.filter(Episode => IsLongPreparation(Episode) && Episode.Metrics.ShortPauses >= 2);
	es_RepeatedGapEpisodes.sort((A, B) => B.Metrics.ShortPauses - A.Metrics.ShortPauses || A.Start - B.Start);
	let Data = {
		Source: es_Path.basename(Source), Sha256: es_Crypto.createHash('sha256').update(Buffer).digest('hex'), Bytes: Buffer.length,
		Header: Demo.Header, Timing, Frames: Demo.Frames.length, Scores: Demo.Scores.length, EndOffset: Demo.EndOffset, Events: Demo.Events,
		FinalScore: Analysis.FinalScore, Summary: Analysis.Summary, Points: Analysis.Points, Candidates: Analysis.Candidates, VirtualAim: Analysis.VirtualAim, Recorded: Analysis.Recorded, Impact: Analysis.Impact,
		MinSeconds: Analysis.MinSeconds, MinFrames: Analysis.MinFrames, Windows: Analysis.WindowSizes, Checks,
		RepeatedGapEpisodeIds: es_RepeatedGapEpisodes.map(Episode => Episode.Id),
		Episodes: Analysis.Episodes.map(Episode => ({ Id: Episode.Id, Player: Episode.Player, Point: Episode.Point, Score: Episode.Score, Context: Episode.Context, Start: Episode.Start, End: Episode.End, Duration: Episode.Duration, Metrics: Episode.Metrics })),
		Raw: Raw.toString('base64'), RawStates: States.toString('base64'), StatePresent: StatePresent.toString('base64'), FrameOffsets: Demo.Frames.map(Frame => Frame.Offset),
		VisualVerification: 'Flagged passages require manual review in the replay.',
		Command: '& "' + process.execPath + '" "' + __filename + '" "' + es_Path.resolve(Source) + '" --out "' + es_Path.resolve(Filename) + '" --self-test'
	};
	let Json = JSON.stringify(Data).replace(/</g, '\\u003c');
	let Focus = FocusCharts(Demo, Timing, Analysis);
	let PeakRows = Analysis.VirtualAim.Summary.map(Peak => '<tr><td>' + EscapeHtml(Peak.Name) + '</td><td>' + Peak.MaxAbs.toFixed(2) + ' cm</td><td>' + Peak.Min.toFixed(2) + ' / ' + Peak.Max.toFixed(2) + ' cm</td><td>Point ' + Peak.Point + ' · ' + EscapeHtml(Peak.Score) + '</td><td>' + Peak.Frame + ' · ' + TimeText(Peak.Frame * Timing.StepMs / 1000.0) + '</td></tr>').join('');
	let RecordedRows = Analysis.Recorded.Summary.map(Own => '<tr><td>' + EscapeHtml(Own.Name) + '</td><td>' + Own.LongWithShortGaps + ' / ' + Own.LongEpisodes + '</td><td>' + Own.RecordedPlateaus + '</td><td>' + Own.Aim.Gaps.length + '</td><td>' + Own.Move.Gaps.length + '</td><td>' + (Own.FilteredMax === null ? '—' : Own.FilteredMax.toFixed(2)) + ' cm</td><td>' + (Own.Top10Mean === null ? '—' : Own.Top10Mean.toFixed(2)) + ' cm (' + Own.Top10Count + ')</td></tr>').join('');
	let ReleaseRows = Analysis.Recorded.Summary.map(Own => '<tr><td>' + EscapeHtml(Own.Name) + '</td>' + Own.ReleaseBins.map(Bin => '<td>' + (Bin.NeutralPercent === null ? '—' : Bin.NeutralPercent.toFixed(2) + ' % (' + Bin.Neutral + '/' + Bin.Frames + ')') + '</td>').join('') + '<td>' + Own.Recurrence.Within001cm + '/' + Own.Recurrence.Frames + '</td></tr>').join('');
	let Html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">
<title>TE4 Replay Input Analysis · ${EscapeHtml(Demo.Header.Names.join(' / '))}</title>
<style>
:root{color-scheme:dark;--bg:#101923;--card:#182535;--line:#30475e;--ink:#e5edf7;--muted:#a8bbcd;--blue:#67c5ff;--amber:#ffcb70;--green:#8be0ba}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:32px 28px 80px}h1{font-size:29px;line-height:1.25;margin:8px 0 12px}h2{font-size:20px;margin:0 0 14px}p{max-width:1100px;margin:9px 0}small,.muted{color:var(--muted)}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px;margin-top:22px}.tag{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--blue)}.notice{border-left:4px solid var(--amber);padding-left:16px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 9px;vertical-align:top}th{color:var(--muted);font-weight:600}td.nowrap{white-space:nowrap}button,select,input{background:#20364a;color:var(--ink);border:1px solid #49627c;border-radius:6px;padding:7px 10px;font:inherit}button{cursor:pointer}button:hover{background:#2a4e69}.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.metric{font-size:22px;color:var(--green)}.pill{padding:2px 8px;border-radius:4px;background:#36412e;color:#f7d28d}.chart{display:block;width:100%;height:auto;background:#111c28;border-radius:8px}.sequence{font:13px/1.8 ui-monospace,monospace;overflow-wrap:anywhere;color:var(--blue)}details{margin-top:15px}summary{cursor:pointer;color:var(--blue)}code,pre{font:12px/1.6 ui-monospace,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:var(--blue)}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--muted)}@media(max-width:850px){main{padding:18px 12px}.grid{grid-template-columns:1fr}section{padding:15px}}
</style>
<main>
<div class="tag">Offline replay analysis · Build ${Demo.Header.Build}</div>
<h1>${EscapeHtml(Demo.Header.Names.join(' vs. '))}</h1>
<p id="subtitle"></p>
<section><h2>Match summary</h2><div id="conclusion" class="notice"></div><div id="comparison" class="scroll"></div>
<p class="muted">The same detector and thresholds apply to both players. A broader sample is needed to estimate a false positive rate. The analysis assumes keyboard or controller input.</p></section>
<section><h2>Repeated neutral gaps in preparations over 0.5 s</h2>
<p>This check uses the recorded inputs and works without position or aim debug data. A preparation counts when m_Fire stays active for more than 0.5 s and m_Jx returns to neutral for 85 ms or less at least twice, with the same direction before and after each gap.</p>
<p id="gapContext" class="muted"></p><div id="gapRates" class="scroll"></div>
<h3>Points to review</h3>
<p>The list starts with the eight preparations per player with the most gaps. Select a point to highlight the whole preparation in the Point inspector.</p>
<div class="controls"><label><input id="allGapPreparations" type="checkbox"> Show all matching preparations</label></div><div id="gapPoints" class="scroll"></div></section>
<section id="recorded"><h2>Recorded debug data</h2>
<p>${Analysis.Recorded.Frames.toLocaleString('en-US')} of ${Demo.Frames.length.toLocaleString('en-US')} frames contain both players’ X, Y and m_Vjx (${(Analysis.Recorded.Coverage * 100).toFixed(2)}%). Recorded values come directly from the replay’s debug data.</p>
<div class="scroll"><table><thead><tr><th>Player</th><th>Preparations over 0.5 s with gaps / total</th><th>Windows with a recorded plateau</th><th>Gaps while aiming</th><th>Gaps while moving</th><th>Highest peak ≤550 cm</th><th>Mean of top 10% of peaks</th></tr></thead><tbody>${RecordedRows}</tbody></table></div>
<p>These counts exclude serves and time between points. A gap is a return to neutral m_Jx for 1 to 5 frames (≤85 ms) between inputs in the same direction. A recorded plateau lasts at least 0.5 s, contains at least three pauses and stays within a 60 cm band, with a median absolute aim of at least 180 cm and a peak below 550 cm. Each preparation counts once. The peak statistics use the maximum absolute aim from each preparation. They omit peaks over 550 cm and zero peaks. The top 10% count rounds up.</p>
<h3>Neutral m_Jx by aim on the previous frame</h3><div class="scroll"><table><thead><tr><th>Player</th><th>200 ≤ previous |m_Vjx| &lt;290 cm</th><th>290–310 cm</th><th>310–400 cm</th><th>Frames reproduced within 0.01 cm</th></tr></thead><tbody>${ReleaseRows}</tbody></table></div>
<p>The percentages show how often m_Jx is neutral during a shot preparation, grouped by the previous frame’s recorded |m_Vjx|. Consecutive frames are related. The reproduction check uses the previous frame’s Y to apply AimHuman accumulation or decay and excludes reversals and apparent resets.</p>
<p class="notice">Rapid input changes can also come from the controller or the player. When reviewing a plateau in recorded aim, check whether the pattern repeats while aiming and how often it appears during normal movement. Recorded m_Vjx is an internal aim value. Input restoration and shot accuracy can affect the final ball target.</p></section>
<section id="virtual-aim"${Analysis.Recorded.Coverage >= 0.99 ? ' hidden' : ''}><h2>Peak simulated m_Vjx from the baseline</h2>
<div class="scroll"><table><thead><tr><th>Player</th><th>Absolute peak outside serves</th><th>Signed minimum / maximum</th><th>Point with the absolute peak</th><th>Match frame and time</th></tr></thead><tbody>${PeakRows}</tbody></table></div>
<p>The model fixes |y| at 1189 cm and uses a frame step of ${(Analysis.VirtualAim.StepSeconds * 1000).toFixed(6)} ms. It adds ${Analysis.VirtualAim.Scale.toFixed(9)} cm per frame in the same direction and multiplies aim by ${Analysis.VirtualAim.Decay.toFixed(9)} per neutral frame. The initial aim after a first input or reversal is ±${(100.0 + Analysis.VirtualAim.Scale * Analysis.VirtualAim.RallyIgnoredFrames).toFixed(6)} cm. This includes ${Analysis.VirtualAim.RallyIgnoredFrames} frames of shot compensation derived from the ${Demo.Header.LagFrames} frames of recorded lag.</p>
<p class="notice">The model resets at the start of each continuous m_Fire preparation or change of context. A preparation can span several shots. The model omits movement, resets at impact and input restoration. Its output can extend well beyond the court. It uses double-precision arithmetic to approximate the game’s fixed-point accumulation.</p></section>
<section><h2>Lateral aim at impact</h2>
<p>The histogram uses recorded |m_Vjx| for shots where holding left or right from the first m_Fire would have allowed aim to exceed 400 cm before the input cutoff. The model uses each player's recorded position on every frame. The timing plots include shots where m_Jx was neutral just before m_Fire and later became active. The shaded diagonal band spans one frame either side of the latest possible start for exceeding 400 cm.</p>
<div class="controls"><label><input id="confirmedImpact" type="checkbox"> Show only timestamped impacts</label></div>
<div id="impact"></div></section>
<section id="focused-charts"><h2>Frame-by-frame m_Jx for selected preparations</h2>
<p>Up to 12 preparations appear here, including the eight highest-ranked and the first four with a recorded plateau. The table and Point inspector list the rest. Hover over a dot to read its frame and values. The lower strip encodes m_Fire values of 1 (blue), 2 (purple) and 3 (green). The green aim trace appears when at least 99% of the match has debug data.</p>${Focus}</section>
<section><h2>Passages to review with the aiming indicator</h2>
<p>Each entry marks a window of at least 0.5 s containing the listed pattern. The report keeps the highest-ranked window for each preparation.</p>
<div class="controls"><label>Player <select id="player"><option value="all">Both players</option><option value="0">Player 1</option><option value="1">Player 2</option></select></label><label><input id="services" type="checkbox"> Include serves</label><button id="csvCandidates">Export flagged passages (CSV)</button></div>
<div id="candidates" class="scroll"></div></section>
<section><h2>Point inspector</h2><div class="controls"><button id="previous" aria-label="Previous point">←</button><label>Point <select id="point"></select></label><button id="next" aria-label="Next point">→</button><label><input id="models" type="checkbox" checked> Show ${Analysis.Recorded.Coverage >= 0.99 ? 'recorded m_Vjx' : 'aim models'}</label></div>
<p id="pointInfo"></p><div class="legend"><span style="color:#67c5ff">Blue · Decoded m_Jx</span><span style="color:#ffcb70">Amber · Flagged window</span><span style="color:#8be0ba">Green · ${Analysis.Recorded.Coverage >= 0.99 ? 'Recorded m_Vjx' : 'Simulated aim'}</span><span>Gray background · Player’s serve</span></div><div id="charts"></div>
<p id="cursor" class="muted">Click a chart to read both players’ inputs for that frame.</p><pre id="sequence" class="sequence"></pre>
<details><summary>All shot preparations for this point (m_Fire 1–3)</summary><div id="episodes" class="scroll"></div></details></section>
<section><h2>Methods and limitations</h2>
<p>The detector looks for short neutral gaps, direction reversals, active and neutral run lengths, and repeating cycles. It preserves the original 16 input bits. The sign of m_Jx accounts for the 1% dead zone. Displayed amplitudes approximate the game’s fixed-point calculations.</p>
<p>The screening models use fixed |y| values of 900, 1189 and 1600 cm. Each starts at zero with a new preparation, resets aim to ±100 on a first input or reversal, accumulates aim in the active direction and decays at neutral. The baseline peak table and close-up tooltips include nominal lag compensation on first input and reversal. These simulations use only the recorded inputs and timing.</p>
<p>The short-gap check requires at least two internal pauses of 85 ms or less between inputs in the same direction, four or more changes and 15–92% active frames. The cadence check requires at least three pauses and three periods, at least 0.85 autocorrelation and a period coefficient of variation of 0.20 or less. A simulated plateau needs two or more pauses and agreement between at least two fixed positions, each with a median absolute aim of at least 180 cm, a P90–P10 range of 18% or less and drift of 8% or less between window halves. A repeated release threshold requires at least three releases within 35 cm in at least two models. The reversal check requires four or more reversals among active inputs. Matching aim levels are counted within 25 cm between distinct preparations that meet the simulated plateau criteria.</p>
<p>Recorded serve events identify the server’s serve preparations. A continuous preparation can span several shots and includes changes between m_Fire values 1, 2 and 3. The value 4 represents a gesture.</p>
<p>Points are numbered from 1 using recorded score events. The score is shown before the point in player 1 / player 2 order. Match time refers to the replay’s simulation clock. Time within the point starts at the first recorded serve attempt for that point. A double fault belongs to the same point.</p>
<details><summary>File validation and self-checks</summary><pre id="audit"></pre></details>
<details><summary>Rerun the analyzer</summary><p>Node.js is the only runtime dependency. The report is self-contained and works offline.</p><pre id="command"></pre></details>
<div class="controls"><button id="csvAll">Export all inputs (CSV)</button><button id="csvFire">Export inputs with m_Fire ≠ 0 (CSV)</button><button id="json">Export measurements (JSON)</button></div>
</section></main>
<script id="data" type="application/json">${Json}</script>
<script>
'use strict';
const D = JSON.parse(document.getElementById('data').textContent);
const Bytes = Uint8Array.from(atob(D.Raw), Char => Char.charCodeAt(0));
const View = new DataView(Bytes.buffer);
const StateBytes = Uint8Array.from(atob(D.RawStates), Char => Char.charCodeAt(0));
const StateView = new DataView(StateBytes.buffer);
const Present = Uint8Array.from(atob(D.StatePresent), Char => Char.charCodeAt(0));
const E = Id => document.getElementById(Id);
const Esc = Value => String(Value).replace(/[&<>"']/g, Char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[Char]));
const Fmt = (Value, Digits = 3) => Number(Value).toFixed(Digits);
const Clock = Seconds => Math.floor(Seconds/60).toString().padStart(2,'0') + ':' + (Seconds%60).toFixed(3).padStart(6,'0');
const Seconds = Frame => (D.Timing.OriginMs + Frame * D.Timing.StepMs) / 1000;
let SelectedPreparation = null;
function OpenPoint(Point, Preparation = null)
{
 SelectedPreparation=Preparation;
 E('point').value=Point;
 RenderPoint();
 E('pointInfo').scrollIntoView({behavior:'smooth',block:'start'});
}
function RenderRepeatedGapPoints()
{
 const All=E('allGapPreparations').checked, PerPlayer=[0,0];
 const Episodes=D.RepeatedGapEpisodeIds.map(Id=>D.Episodes[Id]).filter(A=>All||++PerPlayer[A.Player]<=8);
 E('gapPoints').innerHTML=Episodes.length?'<table><thead><tr><th>Point / score before point</th><th>Player</th><th>Match time</th><th>Time in point</th><th>Preparation duration</th><th>Short gaps</th></tr></thead><tbody>'+Episodes.map(A=>{
  const Point=D.Points[A.Point-1], StartInPoint=Point.Services.length?Fmt((A.Start-Point.Start)*D.Timing.StepMs/1000)+' s':'—';
  return '<tr><td><button data-preparation="'+A.Id+'">Point '+A.Point+'</button><br>'+Esc(A.Score)+'</td><td>'+Esc(D.Header.Names[A.Player])+'</td><td class="nowrap">'+Clock(Seconds(A.Start))+' → '+Clock(Seconds(A.End+1))+'</td><td>'+StartInPoint+'</td><td>'+Fmt(A.Duration)+' s</td><td>'+A.Metrics.ShortPauses+'</td></tr>';
 }).join('')+'</tbody></table>':'<p>No matching preparations.</p>';
 E('gapPoints').querySelectorAll('[data-preparation]').forEach(Button=>Button.onclick=()=>{
  const Preparation=Number(Button.dataset.preparation);
  OpenPoint(D.Episodes[Preparation].Point,Preparation);
 });
}
function RenderImpact()
{
 const Impact=D.Impact, Control=E('confirmedImpact'), Target=E('impact');
 if(Impact.Unavailable){Control.disabled=true;Target.textContent=Impact.Unavailable;return;}
 const Rows=Impact.Rows.filter(Row=>!Control.checked||Row.Confirmed);
 if(!Rows.length){Target.textContent='No eligible shots for this filter.';return;}
 const Players=[0,1], Colors=['#67c5ff','#ffba78'], Groups=Players.map(Player=>Rows.filter(Row=>Row.Player===Player));
 const BinWidth=20, MaxAim=Math.max(440, Math.ceil(Math.max(...Rows.map(Row=>Math.abs(Row.MeasuredCm)))/BinWidth)*BinWidth);
 const Bins=Groups.map(Group=>{
  const Counts=new Array(MaxAim/BinWidth).fill(0);
  for(const Row of Group){++Counts[Math.min(Counts.length-1,Math.floor(Math.abs(Row.MeasuredCm)/BinWidth))];}
  return Counts.map(Count=>Group.length?100*Count/Group.length:0);
 });
 const MaxPercent=5*Math.ceil(Math.max(...Bins.flat())/5);
 const X=Cm=>60+Cm/MaxAim*900, Y=Percent=>224-Percent/MaxPercent*184;
 let Histogram='<svg class="chart" viewBox="0 0 1000 270" role="img" aria-label="Distribution of recorded lateral aim at impact">';
 for(let Percent=0;Percent<=MaxPercent;Percent+=Math.max(5,MaxPercent/5)){
  Histogram+='<path d="M60 '+Y(Percent)+'H960" stroke="#30475e"/><text x="52" y="'+(Y(Percent)+4)+'" text-anchor="end" fill="#a8bbcd" font-size="12">'+Fmt(Percent,0)+'%</text>';
 }
 const AimTick=100*Math.max(1,Math.ceil(MaxAim/1000));
 for(let Cm=0;Cm<=MaxAim;Cm+=AimTick){Histogram+='<text x="'+X(Cm)+'" y="242" text-anchor="middle" fill="#a8bbcd" font-size="12">'+Cm+'</text>';}
 for(const Player of Players){
  if(!Groups[Player].length){continue;}
  const Path=Bins[Player].map((Value,Index)=>'V'+Y(Value)+'H'+X((Index+1)*BinWidth)).join('');
  Histogram+='<path d="M60 224'+Path+'V224" fill="'+Colors[Player]+'" fill-opacity=".09" stroke="'+Colors[Player]+'" stroke-width="2"/>';
 }
 Histogram+='<path d="M'+X(400)+' 34V224" stroke="#e5edf7" stroke-dasharray="5 5"/><text x="500" y="263" text-anchor="middle" fill="#a8bbcd" font-size="13">Recorded |m_Vjx| at impact (cm)</text></svg>';

 const TimingRows=Rows.filter(Row=>Row.NeutralBeforeFire&&Row.WaitMs!==null);
 const Limit=200*Math.max(1,Math.ceil(Math.max(0,...TimingRows.map(Row=>Math.max(Row.MarginMs,Row.WaitMs)))/200));
 const TimingCharts=Players.map(Player=>{
  const Own=TimingRows.filter(Row=>Row.Player===Player);
  if(!Own.length){return '<p>'+Esc(D.Header.Names[Player])+' has no eligible timing rows.</p>';}
  const x=Ms=>50+Ms/Limit*420, y=Ms=>215-Ms/Limit*175, Step=Impact.StepMs;
  let Plot='<svg class="chart" viewBox="0 0 500 263" role="img" aria-label="Direction start delay for '+Esc(D.Header.Names[Player])+'"><text x="50" y="25" fill="'+Colors[Player]+'" font-size="15">'+Esc(D.Header.Names[Player])+' ('+Own.length+')</text>';
  const Tick=200*Math.max(1,Math.ceil(Limit/1000));
  for(let Time=0;Time<=Limit;Time+=Tick){
   Plot+='<path d="M'+x(Time)+' 40V215M50 '+y(Time)+'H470" stroke="#30475e"/><text x="'+x(Time)+'" y="232" text-anchor="middle" fill="#a8bbcd" font-size="11">'+Time+'</text><text x="45" y="'+(y(Time)+4)+'" text-anchor="end" fill="#a8bbcd" font-size="11">'+Time+'</text>';
  }
  Plot+='<polygon points="50,215 '+x(Step)+',215 470,'+y(Limit-Step)+' 470,40 '+x(Limit-Step)+',40 50,'+y(Step)+'" fill="#e5edf7" opacity=".18"/>';
  for(const Row of Own.slice().sort((A,B)=>Number(A.Confirmed)-Number(B.Confirmed))){
   Plot+='<circle cx="'+x(Row.MarginMs)+'" cy="'+y(Row.WaitMs)+'" r="3.4" fill="'+(Row.Confirmed?'#111c28':Colors[Player])+'" fill-opacity="'+(Row.Confirmed?'1':'.48')+'" stroke="'+(Row.Confirmed?Colors[Player]:'none')+'"><title>Point '+Row.Point+' · '+Esc(Row.Score)+' · '+(Row.Confirmed?'Timestamped':'Estimated')+' impact · Wait '+Fmt(Row.WaitMs,0)+' ms · Latest start '+Fmt(Row.MarginMs,0)+' ms · m_Vjx '+Fmt(Row.MeasuredCm,1)+' cm</title></circle>';
  }
  return Plot+'<text x="260" y="253" text-anchor="middle" fill="#a8bbcd" font-size="11">Latest start to exceed 400 cm (ms)</text></svg>';
 });

 const Summary=Groups.map((Group,Player)=>{
  const Aim=Group.map(Row=>Math.abs(Row.MeasuredCm)).sort((A,B)=>A-B);
  const Median=Aim.length?Fmt((Aim[Math.floor((Aim.length-1)/2)]+Aim[Math.floor(Aim.length/2)])/2,1):'—';
  const Peak=Aim.length?Fmt(Aim.at(-1),1):'—';
  return '<tr><td><span style="color:'+Colors[Player]+'">●</span> '+Esc(D.Header.Names[Player])+'</td><td>'+Aim.length+'</td><td>'+Median+'</td><td>'+Peak+'</td><td>'+Aim.filter(Value=>Value>400).length+'</td></tr>';
 }).join('');
 const Skipped=Impact.Counts.reduce((Total,Count)=>Total+Count.FirstContactsSkipped,0);
 Target.innerHTML='<div class="scroll"><table><thead><tr><th>Player</th><th>Shots in histogram</th><th>Median (cm)</th><th>Peak (cm)</th><th>Over 400 cm</th></tr></thead><tbody>'+Summary+'</tbody></table></div>'+Histogram+'<h3>Wait before the first lateral input (ms)</h3><div class="grid">'+TimingCharts.join('')+'</div><p class="muted">Open circles mark timestamped impacts. Filled dots mark impacts estimated from ball trajectory. The trajectory check matched '+Impact.Agreements+' of '+Impact.ConfirmedContacts+' timestamped non-serve impacts. The input cutoff is '+Impact.IgnoredFrames+' frame(s) before the impact.'+(Skipped?' '+Skipped+' first contacts after the serve were excluded because the return can use a different cutoff.':'')+'</p>';
}
function Input(Frame, Player)
{
 const Raw = View.getUint16(Frame*4+Player*2,true), Fire=(Raw>>4)&15, Direction=(Raw>>8)&63, AmplitudeBit=(Raw>>1)&7;
 const Amplitude=AmplitudeBit?0.4+(AmplitudeBit-1)*0.1:0, Angle=Direction*Math.PI*2/64;
 let Jx=Math.cos(Angle)*Amplitude, Jy=Math.sin(Angle)*Amplitude;
 if(Math.abs(Jx)<0.01){Jx=0;} if(Math.abs(Jy)<0.01){Jy=0;}
 return {Raw,Fire,Direction,AmplitudeBit,Jx,Jy,Sign:Math.sign(Jx)};
}
function Recorded(Frame, Player)
{
 if(!Present[Frame]){return null;}
 const Offset=Frame*48+Player*24;
 return {X:StateView.getFloat64(Offset,true),Y:StateView.getFloat64(Offset+8,true),Vjx:StateView.getFloat64(Offset+16,true)};
}
function Download(Name, Text, Type='text/csv;charset=utf-8')
{
 const Link=document.createElement('a'), Url=URL.createObjectURL(new Blob([Text],{type:Type}));
 Link.href=Url;Link.download=Name;Link.click();setTimeout(()=>URL.revokeObjectURL(Url),1000);
}
function Csv(Rows)
{
 return '\uFEFF'+Rows.map(Row=>Row.map(Value=>'"'+String(Value??'').replace(/"/g,'""')+'"').join(';')).join('\\r\\n');
}
function Level(C)
{
 return C.Strength>=3?'Converging indicators':C.Strength>=2?'Intermediate':'Weak / exploratory';
}
function CandidateRows()
{
 return D.Candidates.filter(C=>(E('player').value==='all'||C.Player===Number(E('player').value))&&(E('services').checked||C.Context!=='service'));
}
function RenderCandidates()
{
 const Rows=CandidateRows();
 E('candidates').innerHTML=Rows.length?'<table><thead><tr><th>Point / score before point</th><th>Player</th><th>Match time</th><th>Time in point</th><th>Duration</th><th>Pattern / strength</th><th>Measurements</th></tr></thead><tbody>'+Rows.map(C=>{
 const P=D.Points.find(P=>P.Number===C.Point);
 return '<tr><td><button data-point="'+C.Point+'">Point '+C.Point+'</button><br>'+Esc(C.Score)+'</td><td>'+Esc(D.Header.Names[C.Player])+'<br><small>'+Esc(C.Context)+'</small></td><td class="nowrap">'+Clock(Seconds(C.Start))+' → '+Clock(Seconds(C.End+1))+'</td><td>'+Fmt((C.Start-P.Start)*D.Timing.StepMs/1000)+' s</td><td>'+Fmt(C.Duration)+' s</td><td>'+Esc(C.Methods.join(', '))+'<br><span class="pill">'+Level(C)+'</span></td><td>'+C.ToggleCount+' changes · '+C.Pauses+' pauses<br>active '+Fmt(C.ActiveFraction*100,0)+'% · simulated plateau '+C.PlateauVotes+'/3'+(C.Recorded?'<br>recorded |m_Vjx| · '+Fmt(C.Recorded.Min,1)+'–'+Fmt(C.Recorded.Max,1)+' cm':'')+'<br>autocorr. '+Fmt(C.Periodicity,2)+' · period '+C.PeriodFrames+' frames</td></tr>';
 }).join('')+'</tbody></table>':'<p>No passages match this filter.</p>';
 E('candidates').querySelectorAll('[data-point]').forEach(Button=>Button.onclick=()=>OpenPoint(Button.dataset.point));
}
function Sequence(Signs)
{
 const Runs=[];for(const Sign of Signs){const Last=Runs[Runs.length-1];if(Last&&Last[0]===Sign){++Last[1];}else{Runs.push([Sign,1]);}}
 return Runs.map(R=>(R[0]<0?'L':R[0]>0?'R':'·')+'×'+R[1]).join('  ');
}
function Model(Episode, Baseline)
{
 const Values=[], Dt=D.Timing.StepMs/1000, Scale=720000/(Baseline/2+400)*Dt, Decay=Math.pow(0.2,Dt);let Value=0;
 for(let Frame=Episode.Start;Frame<=Episode.End;++Frame){const Sign=Input(Frame,Episode.Player).Sign;if(!Sign){Value*=Decay;}else if(Value*Sign>0){Value+=Sign*Scale;}else{Value=Sign*100;}Values.push(Value);}return Values;
}
function RenderPoint()
{
 const P=D.Points.find(P=>P.Number===Number(E('point').value)), Start=P.Start, End=P.End, Count=End-Start+1;
 const Selected=D.Episodes[SelectedPreparation], Focus=Selected?.Point===P.Number?Selected:null;
 E('pointInfo').textContent=P.Score+' · Server · '+D.Header.Names[P.Server]+' · Match time '+Clock(Seconds(Start))+'–'+Clock(Seconds(End+1))+' · '+P.Services.length+' recorded serve attempt(s)'+(P.Winner===null?' · Final segment without a scored point':' · Point won by '+D.Header.Names[P.Winner]);
 if(Focus){E('pointInfo').textContent+=' · Highlighted preparation for '+D.Header.Names[Focus.Player]+' · '+Clock(Seconds(Focus.Start))+'–'+Clock(Seconds(Focus.End+1))+' · '+Focus.Metrics.ShortPauses+' short gaps';}
 const Width=1120, Left=62, Right=1095, X=Frame=>Left+(Frame-Start)/Math.max(1,Count-1)*(Right-Left), OwnEpisodes=D.Episodes.filter(A=>A.Point===P.Number);
 E('charts').innerHTML=[0,1].map(Player=>{
 let Svg='<svg class="chart" data-player="'+Player+'" viewBox="0 0 '+Width+' 315" role="img" aria-label="Inputs for '+Esc(D.Header.Names[Player])+'"><text x="16" y="25" fill="#e5edf7" font-size="16">'+Esc(D.Header.Names[Player])+'</text>';
 for(const Service of P.Services){if(P.Server===Player){const A=Math.max(Start,Service.Start),B=Math.min(End,Service.Hit);Svg+='<rect x="'+X(A)+'" y="38" width="'+Math.max(1,X(B)-X(A))+'" height="255" fill="#aaa" opacity=".08"/>';}}
 for(const C of D.Candidates.filter(C=>C.Point===P.Number&&C.Player===Player)){Svg+='<rect x="'+X(C.Start)+'" y="38" width="'+Math.max(2,X(C.End)-X(C.Start))+'" height="255" fill="#ffcb70" opacity=".17"/>';}
 if(Focus?.Player===Player){Svg+='<rect x="'+X(Focus.Start)+'" y="38" width="'+Math.max(2,X(Focus.End)-X(Focus.Start))+'" height="255" fill="#67c5ff" fill-opacity=".08" stroke="#67c5ff" stroke-dasharray="4 3"/>';}
 for(const Value of [-1,0,1]){const Y=90-Value*34;Svg+='<line x1="'+Left+'" x2="'+Right+'" y1="'+Y+'" y2="'+Y+'" stroke="#30475e"/><text x="10" y="'+(Y+4)+'" fill="#a8bbcd" font-size="11">Jx '+Value+'</text>';}
 let Path='',PreviousY=null;
 for(let Frame=Start;Frame<=End;++Frame){const Y=90-Input(Frame,Player).Jx*34;Path+=(Frame===Start?'M':'H')+Fmt(X(Frame),2)+(Frame===Start?' '+Fmt(Y,2):'V'+Fmt(Y,2));PreviousY=Y;}
 Svg+='<path d="'+Path+'" fill="none" stroke="#67c5ff" stroke-width="1.5"/>';
 Svg+='<text x="10" y="159" fill="#a8bbcd" font-size="11">Fire</text>';
 for(let Frame=Start;Frame<=End;++Frame){const Fire=Input(Frame,Player).Fire;if(Fire){Svg+='<rect x="'+X(Frame)+'" y="145" width="'+Math.max(1,(Right-Left)/Count)+'" height="15" fill="'+(['','#5bb2dc','#bd9deb','#8be0ba','#ed8c82'][Fire]||'#fff')+'"/>';}}
 if(E('models').checked){
 Svg+='<line x1="'+Left+'" x2="'+Right+'" y1="228" y2="228" stroke="#30475e"/><text x="10" y="188" fill="#a8bbcd" font-size="10">+800 cm</text><text x="10" y="231" fill="#a8bbcd" font-size="10">0</text><text x="10" y="272" fill="#a8bbcd" font-size="10">−800 cm</text>';
 if(D.Recorded.Coverage>=0.99){let Path='',PreviousRecorded=false;for(let Frame=Start;Frame<=End;++Frame){const R=Recorded(Frame,Player);if(R){const Y=228-Math.max(-800,Math.min(800,R.Vjx))*0.05;Path+=(PreviousRecorded?'L':'M')+Fmt(X(Frame),2)+' '+Fmt(Y,2);}PreviousRecorded=Boolean(R);}Svg+='<path d="'+Path+'" fill="none" stroke="#8be0ba" stroke-width="1.8"/>';}else{
 for(const Episode of OwnEpisodes.filter(A=>A.Player===Player)){
 for(const Baseline of [900,1189,1600]){const Values=Model(Episode,Baseline);let Path='';for(let i=0;i<Values.length;++i){const Frame=Episode.Start+i;if(Frame<Start||Frame>End){continue;}const Y=228-Math.max(-800,Math.min(800,Values[i]))*0.05;Path+=(Path?'L':'M')+Fmt(X(Frame),2)+' '+Fmt(Y,2);}Svg+='<path d="'+Path+'" fill="none" stroke="#8be0ba" stroke-width="'+(Baseline===1189?1.8:0.8)+'" opacity="'+(Baseline===1189?1:0.4)+'"/>';}}
 }
 Svg+='<text x="'+Left+'" y="288" fill="#a8bbcd" font-size="10">'+(D.Recorded.Coverage>=0.99?'Recorded m_Vjx':'Models reset at each preparation')+' · Aim traces limited to −800 to +800 cm</text>';
 }
 for(let i=0;i<=6;++i){const Frame=Start+(Count-1)*i/6;Svg+='<text x="'+X(Frame)+'" y="308" fill="#a8bbcd" font-size="11" text-anchor="middle">'+Fmt((Frame-Start)*D.Timing.StepMs/1000,1)+' s</text>';}
 return Svg+'</svg><p></p>';
 }).join('');
 E('charts').querySelectorAll('svg').forEach(Svg=>Svg.onclick=Event=>{const Rect=Svg.getBoundingClientRect(), Px=(Event.clientX-Rect.left)/Rect.width*Width, Frame=Math.max(Start,Math.min(End,Math.round(Start+(Px-Left)/(Right-Left)*(Count-1))));E('cursor').textContent='Match frame '+Frame+' · Byte '+D.FrameOffsets[Frame]+' · '+Clock(Seconds(Frame))+' · '+[0,1].map(Player=>{const I=Input(Frame,Player),R=Recorded(Frame,Player);return D.Header.Names[Player]+': Fire='+I.Fire+', Jx≈'+Fmt(I.Jx)+', Jy≈'+Fmt(I.Jy)+', direction='+I.Direction+', amplitude='+I.AmplitudeBit+', raw=0x'+I.Raw.toString(16).padStart(4,'0')+(R?', Y='+Fmt(R.Y)+' cm, m_Vjx='+Fmt(R.Vjx)+' cm':'');}).join(' | ');});
 E('sequence').textContent=D.Candidates.filter(C=>C.Point===P.Number).map(C=>D.Header.Names[C.Player]+' · '+Clock(Seconds(C.Start))+' · '+Sequence(Array.from({length:C.End-C.Start+1},(_,i)=>Input(C.Start+i,C.Player).Sign))).join('\\n')||'No flagged window for this point. L = left, R = right, · = neutral. The number after × is the run length in frames.';
 E('episodes').innerHTML='<table><tr><th>Player / context</th><th>Match time</th><th>Duration</th><th>Changes / pauses</th><th>Short gaps</th><th>m_Jx (sign × frames)</th></tr>'+OwnEpisodes.map(A=>'<tr><td>'+Esc(D.Header.Names[A.Player])+'<br>'+Esc(A.Context)+'</td><td>'+Clock(Seconds(A.Start))+'</td><td>'+Fmt(A.Duration)+' s</td><td>'+A.Metrics.ToggleCount+' / '+A.Metrics.Pauses+'</td><td>'+A.Metrics.ShortPauses+'</td><td class="sequence">'+Sequence(Array.from({length:A.End-A.Start+1},(_,i)=>Input(A.Start+i,A.Player).Sign))+'</td></tr>').join('')+'</table>';
}
function ExportInputs(FireOnly)
{
 const Rows=[['Frame0','Point1','ScoreBeforePoint','TimeSeconds','Player1','Name','RawUInt16','Fire','DirectionBit','AmplitudeBit','JxApprox','JyApprox','JxSign','ByteOffset','Context','RecordedXcm','RecordedYcm','RecordedVjxCm']], PointByFrame=new Array(D.Frames);
 for(const P of D.Points){for(let Frame=P.BoundaryStart;Frame<=P.End;++Frame){PointByFrame[Frame]=P;}}
 for(let Frame=0;Frame<D.Frames;++Frame){const P=PointByFrame[Frame];for(let Player=0;Player<2;++Player){const I=Input(Frame,Player),R=Recorded(Frame,Player);if(FireOnly&&!I.Fire){continue;}const Context=Frame<P.Start?'between points':P.Server===Player&&P.Services.some(S=>Frame>=S.Start&&Frame<=S.Hit)?'service':'outside serve';Rows.push([Frame,P.Number,P.Score,Fmt(Seconds(Frame),6),Player+1,D.Header.Names[Player],I.Raw,I.Fire,I.Direction,I.AmplitudeBit,Fmt(I.Jx,8),Fmt(I.Jy,8),I.Sign,D.FrameOffsets[Frame]+Player*2,Context,R?R.X:'',R?R.Y:'',R?R.Vjx:'']);}}
 Download(FireOnly?'inputs-fire.csv':'inputs-all.csv',Csv(Rows));
}
E('subtitle').textContent='Build '+D.Header.Build+'.'+D.Header.SubBuild+' · format '+D.Header.Version+' · '+D.Frames.toLocaleString('en-US')+' frames · '+D.Scores+' scored points · Reconstructed score '+D.FinalScore+' · '+Clock(Seconds(D.Frames-1));
const Medium=D.Summary.reduce((Sum,S)=>Sum+S.Medium,0), CandidateCount=D.Summary.reduce((Sum,S)=>Sum+S.Candidates,0);
E('conclusion').innerHTML='<p><b>'+(Medium?'Review the flagged patterns in the replay.':'The current checks found only weak patterns or no flags outside serves.')+'</b></p><p>'+CandidateCount+' flagged window(s) outside serves. Short neutral gaps can have several causes. Interpret the findings alongside the replay and other evidence.</p>';
E('comparison').innerHTML='<table><tr><th>Player</th><th>Preparations outside serves</th><th>Preparations ≥0.5 s</th><th>Time with Fire active</th><th>Changes / 100 s</th><th>Weak flags</th><th>Intermediate / converging</th></tr>'+D.Summary.map(S=>'<tr><td>'+Esc(S.Name)+'</td><td>'+S.Episodes+'</td><td>'+S.LongEpisodes+'</td><td>'+Fmt(S.FireSeconds,1)+' s</td><td>'+Fmt(S.ToggleCount/S.FireSeconds*100,1)+'</td><td>'+(S.Candidates-S.Medium)+'</td><td>'+(S.Medium-S.High)+' / '+S.High+'</td></tr>').join('')+'</table>';
const WithServeTiming=D.Points.filter(P=>P.Winner!==null&&P.Services.length).length;
E('gapContext').textContent='Serve phases are excluded where their timing is recorded.'+(WithServeTiming<D.Scores?' Serve timing is available for '+WithServeTiming+' of '+D.Scores+' scored points. The rates may include serve or between-point activity on the other points.':'');
E('gapRates').innerHTML='<table><thead><tr><th>Player</th><th>Preparations with ≥2 short gaps</th><th>Preparations over 0.5 s</th><th>Share</th></tr></thead><tbody>'+D.Recorded.Summary.map(S=>'<tr><td>'+Esc(S.Name)+'</td><td>'+S.LongWithRepeatedGaps+'</td><td>'+S.LongEpisodes+'</td><td>'+(S.LongEpisodes?Fmt(100*S.LongWithRepeatedGaps/S.LongEpisodes,1)+'%':'—')+'</td></tr>').join('')+'</tbody></table>';
E('allGapPreparations').onchange=RenderRepeatedGapPoints;
E('player').options[1].textContent=D.Header.Names[0];E('player').options[2].textContent=D.Header.Names[1];
E('point').innerHTML=D.Points.map(P=>'<option value="'+P.Number+'">'+P.Number+' — '+Esc(P.Score)+(P.Winner===null?' (final segment)':'')+'</option>').join('');
if(D.Candidates.length){E('point').value=D.Candidates[0].Point;}
E('point').onchange=RenderPoint;E('models').onchange=RenderPoint;E('player').onchange=RenderCandidates;E('services').onchange=RenderCandidates;
E('previous').onclick=()=>{E('point').selectedIndex=Math.max(0,E('point').selectedIndex-1);RenderPoint();};E('next').onclick=()=>{E('point').selectedIndex=Math.min(E('point').options.length-1,E('point').selectedIndex+1);RenderPoint();};
E('csvAll').onclick=()=>ExportInputs(false);E('csvFire').onclick=()=>ExportInputs(true);
E('csvCandidates').onclick=()=>Download('flagged-passages.csv',Csv([['Point','Score','Player','Context','StartFrame0','EndFrame0','GlobalStartSeconds','PointStartSeconds','DurationSeconds','Strength','Methods','Toggles','Pauses','PlateauVotes','Autocorrelation'],...CandidateRows().map(C=>[C.Point,C.Score,D.Header.Names[C.Player],C.Context,C.Start,C.End,Fmt(Seconds(C.Start),6),Fmt((C.Start-D.Points.find(P=>P.Number===C.Point).Start)*D.Timing.StepMs/1000,6),C.Duration,C.Strength,C.Methods.join(', '),C.ToggleCount,C.Pauses,C.PlateauVotes,C.Periodicity])]));
E('json').onclick=()=>{const Copy={...D};delete Copy.Raw;delete Copy.RawStates;delete Copy.StatePresent;delete Copy.FrameOffsets;Download('dmo-measurements.json',JSON.stringify(Copy,null,2),'application/json');};
E('audit').textContent=JSON.stringify({Source:D.Source,Sha256:D.Sha256,Bytes:D.Bytes,EndOffset:D.EndOffset,HeaderMarker:D.Header.MarkerOffset,BodyOffset:D.Header.BodyOffset,Timing:D.Timing,Events:D.Events,Checks:D.Checks,VisualVerification:D.VisualVerification,Limits:['Player banks and service animation header blocks treated as opaque; unique explicit marker, no silent resync.','Two active human players / both fatigable inferred from unique valid stream; player bank payload not fully deserialized.','Actual Unity CTooFile / DemoPlaying methods not executed; no game serialization or format modified.','Unknown event variants / resync / resumed or other-build files fail closed.','Point numbers and server reconstructed from score events, checked against final score and recorded service payloads.']},null,2);
E('command').textContent=D.Command;
E('confirmedImpact').onchange=RenderImpact;
RenderCandidates();RenderPoint();RenderImpact();RenderRepeatedGapPoints();
</script></html>`;
	es_Assert.notEqual(es_Path.resolve(Filename).toLowerCase(), es_Path.resolve(Source).toLowerCase(), 'Output must not overwrite the demo');
	es_Assert.equal(es_Path.extname(Filename).toLowerCase(), '.html', 'Output must be an .html report');
	es_Fs.writeFileSync(Filename, Html.replace(/\r?\n/g, '\r\n'), 'utf8');
	return Data;
}

function SelfTest(Buffer, Demo, Timing, Analysis)
{
	let Checks = [];
	for (let Direction = 0; Direction < 64; ++Direction)
	{
		for (let Amplitude = 0; Amplitude < 8; ++Amplitude)
		{
			for (let Fire = 0; Fire <= 4; ++Fire)
			{
				let Raw = (Direction << 8) | (Amplitude << 1) | (Fire << 4), Decoded = DecodeInput(Raw);
				es_Assert.equal(Decoded.Direction, Direction); es_Assert.equal(Decoded.AmplitudeBit, Amplitude); es_Assert.equal(Decoded.Fire, Fire);
				es_Assert.equal(Decoded.Sign, !Amplitude || Direction === 16 || Direction === 48 ? 0 : Direction < 16 || Direction > 48 ? 1 : -1);
			}
		}
	}
	Checks.push('2560 combinations of direction / amplitude / Fire decoded; exact signs checked independently.');
	let Reader = new CReader(es_Buffer.from([0x80, 1, ...Array(128).fill(65)]));
	es_Assert.equal(Reader.String(), 'A'.repeat(128));
	es_Assert.equal(Reader.m_Position, 130);
	Checks.push('BinaryReader UTF-8 string with two-byte 7-bit length checked.');
	for (let Cut of [0, 1, 21, Demo.Header.MarkerOffset, Demo.Header.BodyOffset + 1, Demo.Scores[0].Offset + 10, Buffer.length - 1])
	{
		es_Assert.throws(() => ReadDemo(Buffer.subarray(0, Cut)));
	}
	es_Assert.throws(() => ReadDemo(es_Buffer.concat([Buffer, es_Buffer.from([0])])));
	Checks.push('Truncation at 7 boundaries and trailing garbage rejected; no silent stream resynchronization.');
	es_Assert.equal(Demo.EndOffset, Buffer.length);
	for (let i = 1; i < Demo.Frames.length; ++i) { es_Assert.equal(Demo.Frames[i].Offset, Demo.Frames[i - 1].EndOffset); }
	es_Assert.ok(Timing.MaxErrorMs < 0.01);
	Checks.push('Every parsed frame ends exactly where the next starts; all score timestamps fit the same frame clock; exact terminal EOF.');
	let StepSeconds = Timing.StepMs / 1000.0, Positive = [], Value = 0.0, Scale = 720000.0 / (1189.0 / 2.0 + 400.0) * StepSeconds;
	for (let i = 0; i < 240; ++i)
	{
		let Sign = Value < 350.0 ? 1 : 0;
		Positive.push(Sign);
		Value = Sign ? Value > 0 ? Value + Scale : 100.0 : Value * Math.pow(0.2, StepSeconds);
	}
	let PositiveSlice = Positive.slice(100, 161), PositiveModels = [900, 1189, 1600].map(Baseline => SimulateAim(Positive, StepSeconds, Baseline).slice(100, 161));
	let PositiveResult = WindowMetrics(PositiveSlice, PositiveModels, StepSeconds);
	es_Assert.ok(PositiveResult.Strength >= 2 && PositiveResult.PlateauVotes >= 2, 'Failed controlled regulator positive');
	for (let Signs of [Array(120).fill(1), Array(120).fill(0), [...Array(60).fill(1), ...Array(60).fill(0)], [...Array(45).fill(1), ...Array(10).fill(0), ...Array(45).fill(1)]])
	{
		let Result = WindowMetrics(Signs, [900, 1189, 1600].map(Baseline => SimulateAim(Signs, StepSeconds, Baseline)), StepSeconds);
		es_Assert.equal(Result.Strength, 0, 'Flagged simple hold / neutral / one release / single correction');
	}
	Checks.push('Controlled on/off regulator detected; simple holds, neutral, single release and single correction not flagged.');
	for (let Candidate of Analysis.Candidates)
	{
		es_Assert.ok(Candidate.Duration >= Analysis.MinSeconds - 1e-8);
		let Episode = Analysis.Episodes[Candidate.Episode];
		es_Assert.ok(Candidate.Start >= Episode.Start && Candidate.End <= Episode.End);
		for (let i = Candidate.Start; i <= Candidate.End; ++i) { es_Assert.ok(Demo.Frames[i].Inputs[Candidate.Player].Fire >= 1 && Demo.Frames[i].Inputs[Candidate.Player].Fire <= 3); }
	}
	Checks.push('Every retained window is >=0.5 s, inside one point/context/continuous Fire episode, with Fire 1..3 throughout.');
	// The source data may contain either player as the suspicious one: names are
	// never used in the classifier. Check positive and negative signs symmetrically.
	let Mirrored = Positive.map(Sign => -Sign), MirrorResult = WindowMetrics(Mirrored.slice(100, 161), [900, 1189, 1600].map(Baseline => SimulateAim(Mirrored, StepSeconds, Baseline).slice(100, 161)), StepSeconds);
	es_Assert.equal(MirrorResult.Strength, PositiveResult.Strength);
	es_Assert.equal(MirrorResult.PlateauVotes, PositiveResult.PlateauVotes);
	Checks.push('Regulator detection is symmetric for left/right; neither player name enters the classifier.');
	let Virtual = Analysis.VirtualAim, Initial = 100.0 + Virtual.Scale * Virtual.RallyIgnoredFrames;
	let Branches = SimulateAim([1, 1, 0, -1, -1, 0, 1], StepSeconds, 1189, Virtual.RallyIgnoredFrames);
	let Expected = [Initial, Initial + Virtual.Scale, (Initial + Virtual.Scale) * Virtual.Decay, -Initial, -Initial - Virtual.Scale, (-Initial - Virtual.Scale) * Virtual.Decay, Initial];
	for (let i = 0; i < Expected.length; ++i)
	{
		es_Assert.ok(Math.abs(Branches[i] - Expected[i]) < 1e-9, 'Virtual aim branch / lag mismatch');
	}
	for (let Peak of Virtual.Summary)
	{
		let Episode = Analysis.Episodes[Peak.Episode];
		es_Assert.ok(Episode.Context !== 'service');
		es_Assert.equal(Episode.VirtualAim[Peak.Frame - Episode.Start], Peak.SignedPeak);
		es_Assert.equal(Math.abs(Peak.SignedPeak), Peak.MaxAbs);
		for (let Other of Analysis.Episodes.filter(Value => Value.Player === Peak.Player && Value.Context !== 'service'))
		{
			es_Assert.ok(Other.VirtualAim.every(Value => Math.abs(Value) <= Peak.MaxAbs));
		}
	}
	Checks.push('Baseline virtual aim: initial direction, same direction, neutral decay, reversal and lag boost checked; maxima cover every non-service episode.');
	let RecordedCount = 0;
	for (let Frame of Demo.Frames)
	{
		if (!Frame.DebugState)
		{
			continue;
		}
		++RecordedCount;
		for (let i = 0; i < 2; ++i)
		{
			let Offset = Frame.DebugState.Offset + i * 24;
			es_Assert.equal(Frame.DebugState.Players[i].Y, Number(Buffer.readBigInt64LE(Offset + 8)) / es_FixedScale);
			es_Assert.equal(Frame.DebugState.Players[i].VjxRaw, Buffer.readBigInt64LE(Offset + 16).toString());
		}
	}
	es_Assert.equal(RecordedCount, Analysis.Recorded.Frames);
	Checks.push('Every recorded player Y / raw fixed-point Vjx checked against source bytes; debug coverage counted explicitly.');
	return Checks;
}

function Main()
{
	let Args = process.argv.slice(2);
	if (!Args.length || Args[0] === '--help' || Args[0] === '-h')
	{
		console.log(`TE4 Replay Input Analyzer · Online Circuit moderator guide

Requirements
  Keep analyze-dmo.cjs and measure-aim-at-impact.cjs in the same folder.
  Node.js 24 was used for testing. No npm install or game launch is needed.
  Supports online singles in TE4 Builds 167–169, replay formats 32–33.

Run from PowerShell in the scripts folder
  node .\\analyze-dmo.cjs "C:\\path\\to\\match.dmo" --out ".\\match-report.html" --self-test
  Open match-report.html in a browser. Use a different output name per match.
  The console also lists the score, checks and the first flagged passages.
  Under Windows, replays are typically in AppData\\LocalLow\\Mana Games\\Tennis Elbow 4\\Profiles\\Demos.
  --fps overrides the input screening step. Leave it unset for recorded timing.

Review a match
  Compare both players under Repeated neutral gaps in preparations over 0.5 s.
  It works without aim debug data and links the main points to the inspector.
  Use Lateral aim at impact to compare both players' recorded aim.
  Full per-frame debug data and strike antilag are needed for those charts.
  Show only timestamped impacts to cross-check the trajectory estimates.
  Use Passages to review and Point inspector to find a point in the replay
  and check it with the in-game aiming indicator. Serves are hidden by default
  in the flagged-passages table. Export flagged passages or frame-by-frame
  inputs as CSV, or export the measurements as JSON.
  Treat a flag as a lead. Check repeated patterns and plausible controller
  behavior before drawing conclusions. Keep match reports within moderation.`);
		return;
	}
	let Filename = Args[0], Output = es_Path.join(__dirname, 'report.html'), Fps = null, RunTests = false;
	for (let i = 1; i < Args.length; ++i)
	{
		if (Args[i] === '--out') { Output = Args[++i]; }
		else if (Args[i] === '--fps') { Fps = Number(Args[++i]); es_Assert.ok(Fps >= 10 && Fps <= 2000, 'Invalid FPS override'); }
		else if (Args[i] === '--self-test') { RunTests = true; }
		else { throw new Error('Unknown argument: ' + Args[i]); }
	}
	let Buffer = es_Fs.readFileSync(Filename), Demo = ReadDemo(Buffer);
	let Timing = CalibrateTime(Demo, Fps), Analysis = Analyze(Demo, Timing), Checks = RunTests ? SelfTest(Buffer, Demo, Timing, Analysis) : ['Self-tests not requested; structural stream/time checks always run.'];
	const { AnalyzeImpact } = require('./measure-aim-at-impact.cjs');
	try
	{
		Analysis.Impact = AnalyzeImpact(Demo, Timing);
	}
	catch (Error)
	{
		if (!(Error instanceof es_Assert.AssertionError))
		{
			throw Error;
		}
		Analysis.Impact = { Unavailable: 'Impact timing could not be validated. ' + Error.message };
	}
	let Report = WriteReport(Output, Filename, Buffer, Demo, Timing, Analysis, Checks);
	console.log(JSON.stringify({ Report: es_Path.resolve(Output), Sha256: Report.Sha256, Frames: Demo.Frames.length, Points: Demo.Scores.length, FinalScore: Analysis.FinalScore, Summary: Analysis.Summary, RecordedCoverage: Analysis.Recorded.Coverage, RecordedSummary: Analysis.Recorded.Summary.map(Own => ({ ...Own, Aim: { ...Own.Aim, Gaps: Own.Aim.Gaps.length }, Move: { ...Own.Move, Gaps: Own.Move.Gaps.length } })), Checks }, null, 2));
	for (let Candidate of Analysis.Candidates.slice(0, 12))
	{
		let Point = Analysis.Points.find(Point => Point.Number === Candidate.Point);
		console.log([Demo.Header.Names[Candidate.Player], 'point ' + Candidate.Point, Candidate.Score, TimeText((Timing.OriginMs + Candidate.Start * Timing.StepMs) / 1000.0), '+' + ((Candidate.Start - Point.Start) * Timing.StepMs / 1000.0).toFixed(3) + ' s / point', Candidate.Duration.toFixed(3) + ' s', Candidate.Methods.join(', '), 'level=' + Candidate.Strength].join(' | '));
	}
}

module.exports = { CReader, ReadHeader, DecodeInput, ParseFrames, ReadDemo, CalibrateTime, BuildPoints, SimulateAim, VirtualAimSummary, Runs, WindowMetrics, InputCutAnalysis, RecordedAnalysis, Analyze, WriteReport }; // WTSL Forum: WriteReport exported so the admin panel can serve the HTML report.
if (require.main === module)
{
	try { Main(); }
	catch (Error) { console.error(Error.stack); process.exitCode = 1; }
}
