'use strict';

//=== Measure lateral aim at contact from a full-debug singles demo.
// node measure-aim-at-impact.cjs "match.dmo"
const es_Assert = require('node:assert/strict');
const es_Fs = require('node:fs');
const { ReadDemo, CalibrateTime, BuildPoints } = require('./analyze-dmo.cjs');
const es_TargetCm = 400.0;

function FindContacts(Demo, Timing)
{
	const es_LastContacts = new Map(), es_InferredContacts = new Map();
	for (const Score of Demo.Scores)
	{
		if (Score.LastStrikeTime <= 0.0)
		{
			continue;
		}
		const es_Frame = Math.round((Score.LastStrikeTime - Timing.OriginMs) / Timing.StepMs);
		const es_Point = Demo.Frames[Score.Frame].Point;
		es_Assert.equal(Demo.Frames[es_Frame]?.Point, es_Point, 'Last contact outside its point');
		es_Assert.ok(Math.abs(Timing.OriginMs + es_Frame * Timing.StepMs - Score.LastStrikeTime) < 0.01, 'Misaligned impact timestamp');
		es_LastContacts.set(es_Point.Number, { Frame: es_Frame, Player: Score.LastPlayer, Serve: Score.LastStrike >= 5, Confirmed: true });
	}

	for (const Score of Demo.Scores)
	{
		const es_Point = Demo.Frames[Score.Frame].Point;
		const es_Last = es_LastContacts.get(es_Point.Number), es_Serve = es_Point.Services.at(-1);
		if (!es_Serve || !es_Last || es_Last.Serve)
		{
			continue;
		}
		for (let i = es_Serve.Hit + 3; i <= Math.min(es_Last.Frame, es_Point.End - 2); ++i)
		{
			const es_Ball = Demo.Frames[i].DebugState.Ball;
			const es_PreviousY = Demo.Frames[i - 1].DebugState.Ball[1], es_NextY = Demo.Frames[i + 1].DebugState.Ball[1];
			const es_IncomingY = es_Ball[1] - es_PreviousY, es_OutgoingY = es_NextY - es_Ball[1];
			const es_Side = Math.sign(es_IncomingY);
			if (Math.abs(es_IncomingY) < 2.0 || Math.abs(es_OutgoingY) < 2.0 || es_Ball[2] < 2.0 || es_Ball[2] > 450.0
				|| Math.sign(es_OutgoingY) !== -es_Side
				|| Math.sign(es_PreviousY - Demo.Frames[i - 2].DebugState.Ball[1]) !== es_Side
				|| Math.sign(Demo.Frames[i + 2].DebugState.Ball[1] - es_NextY) !== -es_Side)
			{
				continue;
			}
			const es_Players = Demo.Frames[i].DebugState.Players;
			const es_Distance = es_Players.map(Player => Math.hypot(Player.X - es_Ball[0], Player.Y - es_Ball[1]));
			const es_Player = es_Distance[0] < es_Distance[1] ? 0 : 1;
			if (es_Distance[es_Player] <= 220.0 && Math.sign(es_Players[es_Player].Y) === es_Side)
			{
				es_InferredContacts.set(i, { Frame: i, Player: es_Player, Serve: false, Confirmed: false });
			}
		}
	}

	const es_ConfirmedRally = [...es_LastContacts.values()].filter(Contact => !Contact.Serve);
	const es_Agreements = es_ConfirmedRally.filter(Contact => es_InferredContacts.get(Contact.Frame)?.Player === Contact.Player).length;
	for (const Contact of es_ConfirmedRally)
	{
		es_InferredContacts.set(Contact.Frame, Contact);
	}
	return { Contacts: [...es_InferredContacts.values()].sort((a, b) => a.Frame - b.Frame), Confirmed: es_ConfirmedRally.length, Agreements: es_Agreements };
}

function Measure(Demo, Timing, Contacts)
{
	const es_IgnoredFrames = Math.max(0, Math.min(15, Math.trunc((Demo.Header.LagFrames * 75 - 66) / 100) - 2));
	if (!Demo.Frames.every(Frame => Frame.DebugState))
	{
		return { Unavailable: 'The impact charts require debug data on every frame.' };
	}
	if (es_IgnoredFrames === 0)
	{
		return { Unavailable: 'This replay has no strike antilag. The recorded state at impact may already have reset aim.' };
	}

	const es_LastOwnHit = [-1, -1], es_Rows = [], es_PointsSeen = new Set();
	const es_Counts = Demo.Header.Names.map(Name => ({ Name, Contacts: 0, FirstContactsSkipped: 0, NoActivation: 0, CarriedFire: 0, InsufficientTime: 0 }));
	for (const Contact of Contacts)
	{
		const es_Player = Contact.Player, es_End = Contact.Frame - es_IgnoredFrames;
		const es_Point = Demo.Frames[Contact.Frame].Point, es_LastServe = es_Point.Services.at(-1)?.Hit;
		const es_OwnPrevious = es_LastOwnHit[es_Player], es_Count = es_Counts[es_Player];
		es_LastOwnHit[es_Player] = Contact.Frame;
		++es_Count.Contacts;
		const es_FirstContact = !es_PointsSeen.has(es_Point.Number);
		es_PointsSeen.add(es_Point.Number);
		// The return uses a different offset. Skip the first contact when the offsets differ.
		if (es_FirstContact && es_IgnoredFrames !== ((es_IgnoredFrames + 1) >> 1))
		{
			++es_Count.FirstContactsSkipped;
			continue;
		}
		if (es_LastServe === undefined || es_End <= es_LastServe || Demo.Frames[es_End].Inputs[es_Player].Fire === 0 || Demo.Frames[es_End].Inputs[es_Player].Fire > 3)
		{
			++es_Count.NoActivation;
			continue;
		}
		let Start = es_End;
		while (Start > es_LastServe && Demo.Frames[Start - 1].Inputs[es_Player].Fire >= 1 && Demo.Frames[Start - 1].Inputs[es_Player].Fire <= 3)
		{
			--Start;
		}
		if (Start <= Math.max(es_LastServe, es_OwnPrevious))
		{
			++es_Count.CarriedFire;
			continue;
		}

		const es_Steps = [];
		let Potential = 100.0, FirstBeyond = -1, FirstLateral = -1;
		for (let i = Start; i <= es_End; ++i)
		{
			// AimHuman runs before the player's movement for the frame, so use the previous Y.
			const es_Y = Demo.Frames[i - 1].DebugState.Players[es_Player].Y;
			const es_Step = 720000.0 / (Math.abs(es_Y / 2.0) + 400.0) * Timing.StepMs / 1000.0;
			Potential += i === Start ? es_Step * es_IgnoredFrames : es_Step;
			es_Steps.push(es_Step);
			if (FirstBeyond < 0 && Potential > es_TargetCm)
			{
				FirstBeyond = i;
			}
			if (FirstLateral < 0 && Demo.Frames[i].Inputs[es_Player].Sign)
			{
				FirstLateral = i;
			}
		}
		if (Potential <= es_TargetCm)
		{
			++es_Count.InsufficientTime;
			continue;
		}

		let LatestStart = es_End, Tail = 0.0;
		for (; LatestStart > Start; --LatestStart)
		{
			const es_InitialStep = es_Steps[LatestStart - Start];
			if (100.0 + es_InitialStep * es_IgnoredFrames + Tail > es_TargetCm)
			{
				break;
			}
			Tail += es_InitialStep;
		}

		const es_LastState = Demo.Frames[es_End].DebugState.Players[es_Player];
		es_Rows.push({ Player: es_Player, Point: es_Point.Number, Score: es_Point.Score, Frame: Contact.Frame, Time: (Contact.Frame * Timing.StepMs + Timing.OriginMs) / 1000.0, Confirmed: Contact.Confirmed, MeasuredCm: es_LastState.Vjx, PotentialCm: Potential, ReadyMs: (FirstBeyond - Start + 1) * Timing.StepMs, MarginMs: (LatestStart - Start) * Timing.StepMs, WaitMs: FirstLateral < 0 ? null : (FirstLateral - Start) * Timing.StepMs, NeutralBeforeFire: Demo.Frames[Start - 1].Inputs[es_Player].Sign === 0, FireFrame: Start, ReadFrame: es_End });
	}
	return { Rows: es_Rows, Counts: es_Counts, TargetCm: es_TargetCm, IgnoredFrames: es_IgnoredFrames };
}

function AnalyzeImpact(Demo, Timing)
{
	if (!Demo.Frames.every(Frame => Frame.DebugState))
	{
		return { Unavailable: 'The impact charts require debug data on every frame.' };
	}
	const es_RecordedTiming = { ...Timing, StepMs: Timing.RecordedStepMs };
	const es_Contacts = FindContacts(Demo, es_RecordedTiming);
	return { ConfirmedContacts: es_Contacts.Confirmed, Agreements: es_Contacts.Agreements, StepMs: es_RecordedTiming.StepMs, ...Measure(Demo, es_RecordedTiming, es_Contacts.Contacts) };
}

if (require.main === module)
{
	const es_Demo = ReadDemo(es_Fs.readFileSync(process.argv[2]));
	const es_Timing = CalibrateTime(es_Demo);
	const es_PointInfo = BuildPoints(es_Demo);
	console.log(JSON.stringify({ Names: es_Demo.Header.Names, Score: es_PointInfo.FinalScore, ...AnalyzeImpact(es_Demo, es_Timing) }));
}

module.exports = { FindContacts, Measure, AnalyzeImpact };
