import { RRule, RRuleSet, Frequency } from '../src/index'

function take<T>(iterable: Iterable<T>, n: number): T[] {
  const out: T[] = []
  for (const value of iterable) {
    out.push(value)
    if (out.length === n) break
  }
  return out
}

describe('RRule lazy iteration', () => {
  it('is iterable with for...of starting at dtstart', () => {
    const rule = new RRule({
      freq: Frequency.MINUTELY,
      interval: 15,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })

    const first3 = take(rule, 3)

    expect(first3).toEqual([
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T00:15:00Z'),
      new Date('2024-01-01T00:30:00Z'),
    ])
  })

  it('iterate() yields lazily and does not compute past a break', () => {
    const rule = new RRule({
      freq: Frequency.YEARLY,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate()
    expect(iterator.next().value).toEqual(new Date('2024-01-01T00:00:00Z'))
    // No COUNT/UNTIL: stopping here must not hang or finish the sequence.
    expect(iterator.next().value).toEqual(new Date('2025-01-01T00:00:00Z'))
    expect(iterator.next().done).toBe(false)
  })

  it('iterate({ after }) excludes the start point by default', () => {
    const rule = new RRule({
      freq: Frequency.MINUTELY,
      interval: 15,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate({ after: new Date('2024-06-01T00:07:00Z') })
    expect(iterator.next().value).toEqual(new Date('2024-06-01T00:15:00Z'))
  })

  it('iterate({ after, inc: true }) includes the start point when it matches', () => {
    const rule = new RRule({
      freq: Frequency.MINUTELY,
      interval: 15,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate({
      after: new Date('2024-06-01T00:00:00Z'),
      inc: true,
    })
    expect(iterator.next().value).toEqual(new Date('2024-06-01T00:00:00Z'))

    const iterator2 = rule.iterate({
      after: new Date('2024-06-01T00:07:00Z'),
      inc: true,
    })
    expect(iterator2.next().value).toEqual(new Date('2024-06-01T00:15:00Z'))
  })

  it('naturally ends for COUNT rules', () => {
    const rule = new RRule({
      freq: Frequency.DAILY,
      count: 5,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })

    const values: Date[] = []
    // A plain for...of with no break must terminate on its own.
    for (const date of rule) values.push(date)

    expect(values).toHaveLength(5)
    expect(values).toEqual(rule.all())

    // A fully exhausted iterator reports done and yields no further dates.
    const iterator = rule.iterate()
    while (!iterator.next().done) {
      /* drain */
    }
    expect(iterator.next()).toEqual({ value: undefined, done: true })
  })

  it('respects UNTIL', () => {
    const rule = new RRule({
      freq: Frequency.DAILY,
      dtstart: new Date('2024-01-01T00:00:00Z'),
      until: new Date('2024-01-03T00:00:00Z'),
    })

    expect(Array.from(rule)).toEqual(rule.all())
  })

  it('agrees with all() for the first N occurrences', () => {
    const rule = new RRule({
      freq: Frequency.WEEKLY,
      count: 50,
      dtstart: new Date('2024-01-01T09:00:00Z'),
      byweekday: [RRule.MO, RRule.WE, RRule.FR],
    })

    expect(take(rule, 20)).toEqual(rule.all().slice(0, 20))
  })

  it('agrees with all() with a tzid', () => {
    const rule = new RRule({
      freq: Frequency.WEEKLY,
      count: 50,
      dtstart: new Date(Date.UTC(2024, 0, 1, 9, 0, 0)),
      byweekday: [RRule.MO, RRule.FR],
      tzid: 'America/New_York',
    })

    expect(take(rule, 10)).toEqual(rule.all().slice(0, 10))
  })

  it('agrees with after()', () => {
    const rule = new RRule({
      freq: Frequency.HOURLY,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })
    const dt = new Date('2024-03-15T10:30:00Z')

    expect(rule.iterate({ after: dt }).next().value).toEqual(rule.after(dt))
    expect(rule.iterate({ after: dt, inc: true }).next().value).toEqual(
      rule.after(dt, true)
    )
  })

  it('throws on an invalid after date', () => {
    const rule = new RRule({ freq: Frequency.DAILY })
    expect(() => rule.iterate({ after: new Date(NaN) })).toThrow(/Invalid date/)
  })
})

describe('RRuleSet lazy iteration', () => {
  function makeSet() {
    const set = new RRuleSet()
    set.rrule(
      new RRule({
        freq: Frequency.WEEKLY,
        count: 26,
        dtstart: new Date('2024-01-01T09:00:00Z'), // Monday
        byweekday: [RRule.MO],
      })
    )
    set.rrule(
      new RRule({
        freq: Frequency.WEEKLY,
        count: 26,
        dtstart: new Date('2024-01-03T09:00:00Z'), // Wednesday
        byweekday: [RRule.WE],
      })
    )
    // An extra Tuesday occurrence.
    set.rdate(new Date('2024-01-02T09:00:00Z'))
    // Remove the Monday in the second week.
    set.exdate(new Date('2024-01-08T09:00:00Z'))
    return set
  }

  it('merges, excludes and deduplicates exactly like all()', () => {
    const set = makeSet()
    // The prefix of lazy iteration is identical to all()'s prefix.
    expect(take(set, 12)).toEqual(set.all().slice(0, 12))

    // Stopping mid-stream via break yields the same dates as a window query.
    const winEnd = new Date('2024-04-01T00:00:00Z')
    const expected = set.between(new Date('2024-01-01T00:00:00Z'), winEnd, true)
    const collected: Date[] = []
    for (const date of set) {
      if (date > winEnd) break
      collected.push(date)
    }
    expect(collected).toEqual(expected)
  })

  it('supports iterate({ after, inc })', () => {
    const set = makeSet()
    const dt = new Date('2024-01-08T09:00:00Z') // excluded Monday

    // The excluded date never appears, even with inc.
    const inc = take(set.iterate({ after: dt, inc: true }), 3)
    expect(inc).toEqual([
      new Date('2024-01-10T09:00:00Z'), // Wednesday
      new Date('2024-01-15T09:00:00Z'), // Monday
      new Date('2024-01-17T09:00:00Z'), // Wednesday
    ])

    const strict = take(set.iterate({ after: dt }), 3)
    expect(strict).toEqual(inc)
  })

  it('emits duplicate timestamps only once', () => {
    const set = new RRuleSet()
    const shared = new Date('2024-01-01T09:00:00Z')
    set.rrule(
      new RRule({
        freq: Frequency.WEEKLY,
        count: 5,
        dtstart: shared,
        byweekday: [RRule.MO],
      })
    )
    set.rdate(new Date(shared.getTime()))
    set.rdate(new Date(shared.getTime()))

    const first3 = take(set, 3)
    expect(first3).toEqual([
      shared,
      new Date('2024-01-08T09:00:00Z'),
      new Date('2024-01-15T09:00:00Z'),
    ])
    // No timestamp appears twice even though three sources emit Jan 1.
    expect(new Set(first3.map(Number)).size).toBe(3)
  })

  it('applies EXRULEs lazily', () => {
    const set = new RRuleSet()
    set.rrule(
      new RRule({
        freq: Frequency.DAILY,
        dtstart: new Date('2024-01-01T08:00:00Z'),
        count: 10,
      })
    )
    set.exrule(
      new RRule({
        freq: Frequency.DAILY,
        dtstart: new Date('2024-01-03T08:00:00Z'),
        count: 3, // Jan 3, 4, 5
      })
    )

    expect(Array.from(set)).toEqual(set.all())
  })

  it('is iterable as the empty set', () => {
    const set = new RRuleSet()
    expect(Array.from(set)).toEqual([])
  })

  it('agrees with all() for a set carrying a tzid', () => {
    const set = new RRuleSet()
    set.rrule(
      new RRule({
        freq: Frequency.WEEKLY,
        count: 20,
        dtstart: new Date(Date.UTC(2024, 0, 2, 9, 0, 0)),
        byweekday: [RRule.TU, RRule.TH],
        tzid: 'America/New_York',
      })
    )
    set.exdate(set.all()[1])
    expect(take(set, 8)).toEqual(set.all().slice(0, 8))
  })
})

describe('iterator isolation', () => {
  it('multiple iterators and cached all()/between() do not affect each other', () => {
    const rule = new RRule({
      freq: Frequency.MINUTELY,
      interval: 15,
      dtstart: new Date('2024-01-01T00:00:00Z'),
    })

    const a = rule.iterate()
    expect(a.next().value).toEqual(new Date('2024-01-01T00:00:00Z'))

    // Between the two pulls, other code uses the rule in every old way.
    const window = rule.between(
      new Date('2024-02-01T00:00:00Z'),
      new Date('2024-02-01T01:00:00Z'),
      true
    )
    expect(window).toHaveLength(5)

    rule.after(new Date('2024-03-01T00:00:00Z'))

    const b = rule.iterate({ after: new Date('2024-06-01T00:07:00Z') })
    expect(b.next().value).toEqual(new Date('2024-06-01T00:15:00Z'))

    // `a` continues exactly where it was, unaffected by b or the cache.
    expect(a.next().value).toEqual(new Date('2024-01-01T00:15:00Z'))

    // Cache answers remain consistent after iterator use.
    expect(
      rule.between(
        new Date('2024-02-01T00:00:00Z'),
        new Date('2024-02-01T01:00:00Z'),
        true
      )
    ).toEqual(window)
    expect(rule.after(new Date('2024-01-01T00:00:00Z'), true)).toEqual(
      new Date('2024-01-01T00:00:00Z')
    )
  })

  it('iterators over an RRuleSet are independent', () => {
    const set = new RRuleSet()
    set.rrule(
      new RRule({
        freq: Frequency.DAILY,
        count: 30,
        dtstart: new Date('2024-01-01T00:00:00Z'),
      })
    )
    set.all() // make sure eager caching and lazy iteration coexist

    const a = set.iterate()
    const b = set.iterate({
      after: new Date('2024-01-05T00:00:00Z'),
      inc: true,
    })

    expect(a.next().value).toEqual(new Date('2024-01-01T00:00:00Z'))
    expect(b.next().value).toEqual(new Date('2024-01-05T00:00:00Z'))
    expect(a.next().value).toEqual(new Date('2024-01-02T00:00:00Z'))
    expect(b.next().value).toEqual(new Date('2024-01-06T00:00:00Z'))
    expect(a.next().value).toEqual(new Date('2024-01-03T00:00:00Z'))
  })

  it('yielded dates are independent values', () => {
    const rule = new RRule({
      freq: Frequency.DAILY,
      dtstart: new Date('2024-01-01T00:00:00Z'),
      count: 3,
    })
    const first = rule.iterate().next().value as Date
    first.setFullYear(1999)

    expect(rule.all()[0]).toEqual(new Date('2024-01-01T00:00:00Z'))
  })
})
