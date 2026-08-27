import { describe, expect, it } from 'vitest';
import { MAX_COACH_MINUTES, MIN_COACH_MINUTES, parseDuration, parseGoalText } from './ruleParser';

describe('parseGoalText', () => {
  it('handles the canonical PRD §11 phrase', () => {
    const { request, confidence } = parseGoalText(
      "I'm tired but need to study for two hours",
    );
    expect(request.goal).toBe('study');
    expect(request.energy).toBe('low');
    expect(request.durationMin).toBe(120);
    expect(confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('"sleepy" reads as low energy, not as the sleep goal', () => {
    const { request } = parseGoalText('feeling sleepy but I have to work');
    expect(request.goal).toBe('work');
    expect(request.energy).toBe('low');
  });

  it('maps each goal family', () => {
    expect(parseGoalText('help me fall asleep').request.goal).toBe('sleep');
    expect(parseGoalText('I want to meditate').request.goal).toBe('meditate');
    expect(parseGoalText('so stressed, need to unwind').request.goal).toBe('calm');
    expect(parseGoalText('need to wake up before my workout').request.goal).toBe(
      'energize',
    );
    expect(parseGoalText('deep work session').request.goal).toBe('flow');
    expect(parseGoalText('something sensual for tonight').request.goal).toBe(
      'intimacy',
    );
    expect(parseGoalText('set the mood for a romantic evening').request.goal).toBe(
      'intimacy',
    );
  });

  it('maps the flow, calm, and create goal families', () => {
    expect(parseGoalText('time to grind').request.goal).toBe('flow');
    expect(parseGoalText('get into a flow state').request.goal).toBe('flow');
    expect(parseGoalText('feeling anxious and overwhelmed').request.goal).toBe('calm');
    expect(parseGoalText('help me breathe for a bit').request.goal).toBe('calm');
    expect(parseGoalText('help me brainstorm ideas').request.goal).toBe('create');
    expect(parseGoalText('I need to write this evening').request.goal).toBe('create');
    // Plain relaxing still lands on relax, not calm.
    expect(parseGoalText('just want to chill and relax').request.goal).toBe('relax');
  });

  it('bare "arousal" means alertness, never the intimacy goal', () => {
    expect(parseGoalText('my desired arousal is high').request.goal).not.toBe(
      'intimacy',
    );
  });

  it('detects high energy and distraction masking', () => {
    const { request } = parseGoalText(
      "I'm wired and my office is noisy, need to focus",
    );
    expect(request.goal).toBe('work');
    expect(request.energy).toBe('high');
    expect(request.distractionMasking).toBe(0.7);
  });

  it('gives low confidence without a goal keyword', () => {
    expect(parseGoalText('just something for 20 minutes').confidence).toBeLessThan(0.5);
    expect(parseGoalText('qwerty asdf').confidence).toBeLessThan(0.2);
    expect(parseGoalText('qwerty asdf').request.goal).toBeNull();
  });
});

describe('parseDuration', () => {
  it('parses the common phrasings', () => {
    expect(parseDuration('for two hours')).toBe(120);
    expect(parseDuration('about 45 min')).toBe(45);
    expect(parseDuration('90 minutes')).toBe(90);
    expect(parseDuration('half an hour')).toBe(30);
    expect(parseDuration('an hour and a half')).toBe(90);
    expect(parseDuration('a couple of hours')).toBe(120);
    expect(parseDuration('1.5 hours')).toBe(90);
    expect(parseDuration('an hour')).toBe(60);
  });

  it('clamps to the supported range and rejects nonsense', () => {
    expect(parseDuration('12 hours')).toBe(MAX_COACH_MINUTES);
    expect(parseDuration('2 minutes')).toBe(MIN_COACH_MINUTES);
    expect(parseDuration('no time mentioned')).toBeNull();
  });
});
