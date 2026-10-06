import { RRule, RRuleSet, datetime } from '../src'

const UTCDate = (iso: string) => new Date(iso)

/** Drains `n` occurrences from an iterator. */
function take(
  iterator: Iterator<Date>,
  n: number
): { dates: Date[]; done: boolean } {
  const dates: Date[] = []
  let done = false
  for (let i = 0; i < n; i++) {
    const step = iterator.next()
    if (step.done) {
      done = true
      break
    }
    dates.push(step.value)
  }
  return { dates, done }
}

describe('RRule iteration', () => {
  test('RRule is directly iterable with for...of', () => {
    const rule = new RRule({
      freq: RRule.MINUTELY,
      interval: 15,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const dates: Date[] = []
    for (const date of rule) {
      dates.push(date)
      if (dates.length === 3) break
    }

    expect(dates).toEqual([
      UTCDate('2024-01-01T00:00:00Z'),
      UTCDate('2024-01-01T00:15:00Z'),
      UTCDate('2024-01-01T00:30:00Z'),
    ])
  })

  test('for...of values are Dates', () => {
    const rule = new RRule({
      freq: RRule.DAILY,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    for (const date of rule) {
      expect(date instanceof Date).toBe(true)
      break
    }
  })

  test('iterate() yields occurrences one by one', () => {
    const rule = new RRule({
      freq: RRule.MINUTELY,
      interval: 15,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate()
    expect(iterator.next().value).toEqual(UTCDate('2024-01-01T00:00:00Z'))
    expect(iterator.next().value).toEqual(UTCDate('2024-01-01T00:15:00Z'))
  })

  test('iterate({ after }) starts at the first occurrence strictly after', () => {
    const rule = new RRule({
      freq: RRule.MINUTELY,
      interval: 15,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate({ after: UTCDate('2024-06-01T00:07:00Z') })
    const { dates, done } = take(iterator, 3)
    expect(done).toBe(false)
    expect(dates).toEqual([
      UTCDate('2024-06-01T00:15:00Z'),
      UTCDate('2024-06-01T00:30:00Z'),
      UTCDate('2024-06-01T00:45:00Z'),
    ])
  })

  test('iterate({ after, inc: true }) includes the start when it matches', () => {
    const rule = new RRule({
      freq: RRule.MINUTELY,
      interval: 15,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const onOccurrence = rule.iterate({
      after: UTCDate('2024-06-01T00:15:00Z'),
      inc: true,
    })
    expect(take(onOccurrence, 2).dates).toEqual([
      UTCDate('2024-06-01T00:15:00Z'),
      UTCDate('2024-06-01T00:30:00Z'),
    ])

    // inc: true on a non-occurrence behaves like the strict boundary.
    const offOccurrence = rule.iterate({
      after: UTCDate('2024-06-01T00:07:00Z'),
      inc: true,
    })
    expect(offOccurrence.next().value).toEqual(UTCDate('2024-06-01T00:15:00Z'))
  })

  test('after() and the first iterate() value agree', () => {
    const rule = new RRule({
      freq: RRule.WEEKLY,
      byweekday: [RRule.MO, RRule.WE, RRule.FR],
      dtstart: UTCDate('2024-01-01T08:00:00Z'),
    })

    const after = UTCDate('2024-03-13T12:00:00Z')
    expect(rule.iterate({ after }).next().value).toEqual(rule.after(after))
    expect(rule.iterate({ after, inc: true }).next().value).toEqual(
      rule.after(after, true)
    )
  })

  test('COUNT rules end naturally', () => {
    const rule = new RRule({
      freq: RRule.DAILY,
      count: 5,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const collected: Date[] = []
    for (const date of rule) {
      collected.push(date)
    }

    expect(collected).toEqual(rule.all())
    expect(collected).toHaveLength(5)
  })

  test('COUNT is honored when starting after dtstart', () => {
    const rule = new RRule({
      freq: RRule.DAILY,
      count: 5,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate({ after: UTCDate('2024-01-03T12:00:00Z') })
    expect(take(iterator, 10).dates).toEqual([
      UTCDate('2024-01-04T00:00:00Z'),
      UTCDate('2024-01-05T00:00:00Z'),
    ])
    expect(iterator.next().done).toBe(true)
  })

  test('UNTIL rules end at the boundary', () => {
    const rule = new RRule({
      freq: RRule.DAILY,
      until: UTCDate('2024-01-03T00:00:00Z'),
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    expect(Array.from(rule.iterate())).toEqual(rule.all())
  })

  test('breaking early performs no extra computation', () => {
    let accepted = 0
    const rule = new RRule({
      freq: RRule.SECONDLY,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })
    rule.all = jest.fn(rule.all.bind(rule))

    for (const date of rule) {
      ++accepted
      void date
      if (accepted === 1) break
    }

    expect(accepted).toBe(1)
    // Iteration must not fall back to all()
    expect(rule.all).not.toHaveBeenCalled()
  })

  test('yielded dates equal all() up to the same prefix', () => {
    const rule = new RRule({
      freq: RRule.MONTHLY,
      byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR],
      bysetpos: [-1],
      dtstart: UTCDate('2020-01-31T09:30:00Z'),
      count: 40,
    })

    const all = rule.all()
    expect(take(rule.iterate(), 7).dates).toEqual(all.slice(0, 7))
  })

  test('iterating with tzid yields the same times as all()', () => {
    const rule = new RRule({
      freq: RRule.WEEKLY,
      count: 8,
      byweekday: [RRule.MO, RRule.WE, RRule.FR],
      dtstart: datetime(2024, 1, 1, 9, 0, 0),
      tzid: 'America/New_York',
    })

    expect(Array.from(rule.iterate())).toEqual(rule.all())
  })

  test('iterators are independent of each other', () => {
    const rule = new RRule({
      freq: RRule.HOURLY,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const first = rule.iterate()
    const second = rule.iterate()

    expect(first.next().value).toEqual(UTCDate('2024-01-01T00:00:00Z'))
    expect(first.next().value).toEqual(UTCDate('2024-01-01T01:00:00Z'))

    // A freshly opened iterator starts from the beginning.
    expect(second.next().value).toEqual(UTCDate('2024-01-01T00:00:00Z'))

    // Advancing one does not move the other.
    expect(second.next().value).toEqual(UTCDate('2024-01-01T01:00:00Z'))
    expect(first.next().value).toEqual(UTCDate('2024-01-01T02:00:00Z'))

    // Two for...of loops over the same rule are independent as well.
    const a = take(rule[Symbol.iterator](), 2).dates
    const b = take(rule[Symbol.iterator](), 3).dates
    expect(a).toEqual([
      UTCDate('2024-01-01T00:00:00Z'),
      UTCDate('2024-01-01T01:00:00Z'),
    ])
    expect(b).toEqual([
      UTCDate('2024-01-01T00:00:00Z'),
      UTCDate('2024-01-01T01:00:00Z'),
      UTCDate('2024-01-01T02:00:00Z'),
    ])
  })

  test('iteration does not interfere with all/between/after', () => {
    const rule = new RRule({
      freq: RRule.HOURLY,
      count: 200,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    const iterator = rule.iterate()
    expect(take(iterator, 3).dates.map(Number)).toEqual(
      rule.all().slice(0, 3).map(Number)
    )

    // Querying while an iterator is open doesn't move it.
    expect(
      rule.between(
        UTCDate('2024-01-02T00:00:00Z'),
        UTCDate('2024-01-03T00:00:00Z'),
        true
      )
    ).toHaveLength(25)
    expect(iterator.next().value).toEqual(UTCDate('2024-01-01T03:00:00Z'))

    // And iterating after all() was cached still returns full results.
    expect(take(rule.iterate(), 5).dates).toEqual(rule.all().slice(0, 5))
    expect(
      rule.iterate({ after: UTCDate('2024-01-05T00:00:00Z') }).next().value
    ).toEqual(rule.after(UTCDate('2024-01-05T00:00:00Z')))
  })

  test('existing all/between/before/after behavior is unchanged', () => {
    const rule = new RRule({
      freq: RRule.DAILY,
      count: 5,
      dtstart: UTCDate('2024-01-01T00:00:00Z'),
    })

    expect(rule.all().map(Number)).toEqual(
      [1, 2, 3, 4, 5].map((d) => UTCDate(`2024-01-0${d}T00:00:00Z`).getTime())
    )
    const collected: number[] = []
    rule.all((date) => {
      collected.push(date.getUTCDate())
      return collected.length < 2
    })
    expect(collected).toEqual([1, 2])

    expect(
      rule.between(
        UTCDate('2024-01-02T00:00:00Z'),
        UTCDate('2024-01-04T00:00:00Z')
      )
    ).toHaveLength(1)
    expect(
      rule.between(
        UTCDate('2024-01-02T00:00:00Z'),
        UTCDate('2024-01-04T00:00:00Z'),
        true
      )
    ).toHaveLength(3)
    expect(rule.before(UTCDate('2024-01-03T12:00:00Z'))).toEqual(
      UTCDate('2024-01-03T00:00:00Z')
    )
    expect(rule.after(UTCDate('2024-01-03T00:00:00Z'), true)).toEqual(
      UTCDate('2024-01-03T00:00:00Z')
    )
  })

  test('iterate() rejects invalid dates', () => {
    const rule = new RRule({ freq: RRule.DAILY })
    expect(() => rule.iterate({ after: new Date(NaN) })).toThrow(
      'Invalid date passed in to RRule.iterate'
    )
  })
})

describe('RRuleSet iteration', () => {
  function buildSet() {
    // Two weekly rules: Mondays and Wednesdays, plus one extra rdate and
    // one exdate that removes an otherwise regular occurrence.
    const set = new RRuleSet()
    set.rdate(UTCDate('2024-01-02T08:00:00Z')) // Tue, manual addition
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        byweekday: [RRule.MO],
        dtstart: UTCDate('2024-01-01T08:00:00Z'),
      })
    )
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        byweekday: [RRule.WE],
        dtstart: UTCDate('2024-01-03T08:00:00Z'),
      })
    )
    set.exdate(UTCDate('2024-01-08T08:00:00Z')) // Mon, removed
    return set
  }

  test('RRuleSet is directly iterable', () => {
    const set = buildSet()
    const expected = [
      UTCDate('2024-01-01T08:00:00Z'), // Mon (rule)
      UTCDate('2024-01-02T08:00:00Z'), // Tue (rdate)
      UTCDate('2024-01-03T08:00:00Z'), // Wed (rule)
      UTCDate('2024-01-10T08:00:00Z'), // Wed
      UTCDate('2024-01-15T08:00:00Z'), // Mon (Jan 8 was excluded)
      UTCDate('2024-01-17T08:00:00Z'), // Wed
    ]

    const dates: Date[] = []
    for (const date of set) {
      dates.push(date)
      if (dates.length === 6) break
    }
    expect(dates).toEqual(expected)
  })

  test('iterated prefix matches a finite set all() with rules, rdate and exdate', () => {
    const set = new RRuleSet()
    set.rdate(UTCDate('2024-01-02T08:00:00Z'))
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        count: 3,
        byweekday: [RRule.MO],
        dtstart: UTCDate('2024-01-01T08:00:00Z'),
      })
    )
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        count: 3,
        byweekday: [RRule.WE],
        dtstart: UTCDate('2024-01-03T08:00:00Z'),
      })
    )
    set.exdate(UTCDate('2024-01-08T08:00:00Z')) // second Monday removed

    const all = set.all()
    const fromIterator = Array.from(set.iterate())

    expect(fromIterator).toEqual(all)
    // Sorted, unique, exdate removed, rdate present.
    expect(all[0]).toEqual(UTCDate('2024-01-01T08:00:00Z'))
    expect(all).toContainEqual(UTCDate('2024-01-02T08:00:00Z'))
    expect(all).not.toContainEqual(UTCDate('2024-01-08T08:00:00Z'))
    expect(new Set(all.map(Number)).size).toBe(all.length)
  })

  test('iterate({ after, inc }) follows the after semantics', () => {
    const set = buildSet()
    const after = UTCDate('2024-01-10T00:00:00Z')

    const strict = take(set.iterate({ after }), 3).dates
    expect(strict).toEqual([
      UTCDate('2024-01-10T08:00:00Z'), // Wed
      UTCDate('2024-01-15T08:00:00Z'), // Mon
      UTCDate('2024-01-17T08:00:00Z'), // Wed
    ])

    const inclusiveStart = UTCDate('2024-01-15T08:00:00Z')
    expect(
      set.iterate({ after: inclusiveStart, inc: true }).next().value
    ).toEqual(inclusiveStart)
    expect(set.after(inclusiveStart, true)).toEqual(inclusiveStart)
  })

  test('excluded occurrences are skipped lazily and sequence stays unique', () => {
    const set = buildSet()
    const dates = take(set.iterate(), 20).dates.map(Number)
    expect(dates).not.toContain(UTCDate('2024-01-08T08:00:00Z').getTime())
    expect(new Set(dates).size).toBe(dates.length)
    const sorted = [...dates].sort((x, y) => x - y)
    expect(dates).toEqual(sorted)
  })

  test('exrules are honored while iterating', () => {
    const set = new RRuleSet()
    set.rrule(
      new RRule({
        freq: RRule.DAILY,
        dtstart: UTCDate('2024-01-01T09:00:00Z'),
      })
    )
    set.exrule(
      new RRule({
        freq: RRule.WEEKLY,
        byweekday: [RRule.SA, RRule.SU],
        dtstart: UTCDate('2024-01-06T09:00:00Z'),
      })
    )

    const iterator = set.iterate()
    expect(take(iterator, 5).dates).toEqual([
      UTCDate('2024-01-01T09:00:00Z'), // Mon
      UTCDate('2024-01-02T09:00:00Z'), // Tue
      UTCDate('2024-01-03T09:00:00Z'), // Wed
      UTCDate('2024-01-04T09:00:00Z'), // Thu
      UTCDate('2024-01-05T09:00:00Z'), // Fri
    ])
    expect(iterator.next().value).toEqual(
      UTCDate('2024-01-08T09:00:00Z') // next Monday, Sat/Sun skipped
    )

    // Starting inside the skipped weekend also jumps to Monday.
    expect(
      set.iterate({ after: UTCDate('2024-01-06T09:00:00Z') }).next().value
    ).toEqual(UTCDate('2024-01-08T09:00:00Z'))
  })

  test('set iterators are independent and isolated from all/between', () => {
    const set = new RRuleSet()
    set.rdate(UTCDate('2024-01-02T08:00:00Z'))
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        count: 10,
        byweekday: [RRule.MO],
        dtstart: UTCDate('2024-01-01T08:00:00Z'),
      })
    )
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        count: 10,
        byweekday: [RRule.WE],
        dtstart: UTCDate('2024-01-03T08:00:00Z'),
      })
    )
    set.exdate(UTCDate('2024-01-08T08:00:00Z'))
    const all = set.all()

    const first = set.iterate()
    const second = set.iterate()
    expect(take(first, 4).dates).toEqual(all.slice(0, 4))
    expect(take(second, 2).dates).toEqual(all.slice(0, 2))

    // Open iterator survives other queries on the same set.
    expect(
      set.between(
        UTCDate('2024-02-01T00:00:00Z'),
        UTCDate('2024-02-29T00:00:00Z'),
        true
      )
    ).toEqual(
      all.filter(
        (d) =>
          d >= UTCDate('2024-02-01T00:00:00Z') &&
          d <= UTCDate('2024-02-29T00:00:00Z')
      )
    )
    expect(first.next().value).toEqual(all[4])

    // Iterating again after the all-cache is populated yields the full prefix.
    expect(take(set.iterate(), 8).dates).toEqual(all.slice(0, 8))
  })

  test('finite set iterator terminates', () => {
    const set = new RRuleSet()
    set.rrule(
      new RRule({
        freq: RRule.DAILY,
        count: 3,
        dtstart: UTCDate('2024-01-01T00:00:00Z'),
      })
    )
    set.rdate(UTCDate('2024-01-15T00:00:00Z'))

    expect(Array.from(set.iterate())).toEqual(set.all())
  })

  test('set iteration with tzid matches all()', () => {
    const set = new RRuleSet()
    set.tzid('America/New_York')
    set.rrule(
      new RRule({
        freq: RRule.WEEKLY,
        count: 4,
        byweekday: [RRule.MO, RRule.WE],
        dtstart: datetime(2024, 1, 1, 9, 0, 0),
      })
    )
    set.rdate(datetime(2024, 1, 5, 9, 0, 0))
    set.exdate(datetime(2024, 1, 8, 9, 0, 0))

    expect(Array.from(set.iterate())).toEqual(set.all())
  })

  test('RRuleSet.iterate() rejects invalid dates', () => {
    const set = new RRuleSet()
    expect(() => set.iterate({ after: new Date(NaN) })).toThrow(
      'Invalid date passed in to RRuleSet.iterate'
    )
  })
})
