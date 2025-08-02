import { DateTime, Duration, type DateTimeUnit } from 'luxon'

const TIMEZONE = 'UTC'

// https://moment.github.io/luxon/#/parsing?id=table-of-tokens
export const DATE_FORMATS = [
	'LLLL d yyyy', // January 5 2023
	'LLLL dd yyyy', // January 05 2023
	'd LLLL yyyy', // 5 February 2013
	'dd LLLL yyyy', // 05 February 2013
	'LLL d, yyyy', // Jul 24, 2018
	'LLLL d, yyyy', // August 12, 2008
	'cccc, d LLLL, yyyy', // Thursday, 19 June, 2025
	'yyyy-LL-dd', // 2016-07-19

	//
	// Edge Cases
	//

	// Amazon uses this format once in a while, but not parsable by luxon directly
	// so we get the error [you can't specify both a weekday of 6 and a date of 2024-03-08T00:00:00.000+01:00]
	// if it matches format, but is considered invalid by luxon (due to missing year)
	'cccc, d LLLL', // Saturday, 8 March

	// Used by MangaDex API
	"yyyy-LL-dd'T'HH:mm:ssZZ", // 2018-01-18T00:00:00+00:00
]

export function string_to_date(input: string | null | undefined, return_error: boolean = false): DateTime {
	if (!input) {
		if (return_error) {
			return DateTime.invalid('[string_to_date] Could not parse [' + input + '] into a valid date - empty value')
		}

		throw new Error(`[string_to_date] Could not parse [${input}] into a valid date - empty value`)
	}

	for (const format of DATE_FORMATS) {
		let parsed = DateTime.fromFormat(input, format)
		if (parsed.isValid) {
			return parsed
		}

		if (parsed.invalidExplanation?.includes("you can't specify both a weekday of")) {
			const newInput = input.split(',').slice(1).join(' ').trim()

			// 8 March
			parsed = DateTime.fromFormat(newInput, 'd LLLL')
			if (parsed.isValid) {
				// If the date is in the past, then add a year, since thats probably whats meant by Amazon
				if (parsed.diffNow().milliseconds < 0) {
					return parsed.plus({ year: 1 })
				}

				return parsed
			}
		}

		// console.log(parsed.invalidExplanation)
	}

	if (return_error) {
		return DateTime.invalid('[string_to_date] Could not parse [' + input + '] into a valid date')
	}

	throw new Error('[string_to_date] Could not parse [' + input + '] into a valid date')
}

// Parse a string or JS Date into a luxon DateTime
export function parse_date(other: string | Date | DateTime, startOf: DateTimeUnit = 'second'): DateTime<boolean> {
	if (other instanceof DateTime) {
		return other
	}

	if (other instanceof Date) {
		return DateTime.fromJSDate(other, { zone: TIMEZONE }).startOf(startOf)
	}

	return DateTime.fromISO(other, { zone: TIMEZONE }).startOf(startOf)
}

// Parse a string or JS Date into a Luxon DateTime, truncating to start of the day
export function parse_date_only(other: string | Date): DateTime<boolean> {
	return parse_date(other, 'day')
}

// diff_from_string returns the difference between NOW() and the provided time, truncating to a day
export function diff_from_string(
	other?: string | Date | DateTime | null,
	startOf: DateTimeUnit = 'day',
): Duration<boolean> {
	if (other == undefined) {
		return Duration.fromObject({})
	}

	return DateTime.local({ zone: TIMEZONE }).startOf(startOf).diff(parse_date(other).startOf(startOf)).rescale()
}

// diff_to_human returns default duration diff
export function diff_to_human(other: Duration): string {
	return other.toHuman({ unitDisplay: 'narrow' })
}

export const FULL_DATE = 'dd LLL yyyy HH:mm:ss'
export const DATE_ONLY = 'dd LLL yyyy'

// date_format_pretty returns a pretty formatted date
export function date_format_pretty(
	other?: string | Date | DateTime | null,
	locale: string = 'en',
	format: string = FULL_DATE,
	removeYear = true,
): string {
	let x: DateTime

	if (other instanceof DateTime) {
		x = other
	} else if (other instanceof Date) {
		x = DateTime.fromJSDate(other, { zone: TIMEZONE })
	} else if (typeof other == 'string') {
		x = DateTime.fromISO(other, { zone: TIMEZONE })
	} else {
		return '- INVALID -'
	}

	let res = x.setLocale(locale).toFormat(format)

	if (removeYear) {
		res = res.replace(DateTime.now().year.toString(), '').trim()
	}

	return res
}
