import { z } from 'zod'
import { fa } from 'zod/v4/locales'

const imprints = z.enum(['Yen Press', 'Yen On', 'JY', 'Yen Audio', 'Ize Press', 'J-Novel Club'])

function null_array<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).transform((val) => (val.length === 0 ? null : val))
}

const currency = z.object({
	value: z.coerce.number(),
	iso_code: z.string(), // ISO 4217
})

const staff = z.object({
	role: z.string(),
	name: z.string().nullish(),
	studio: z.string().nullish(),
})

const distributor = z.object({
	name: imprints,
	link: z.string().url().nullish(),
	imprint: z.boolean().default(false),
})

const related = z.object({
	slug: z.string(),
	title: z.string(),
	link: z.string().url().nullish(),
	cover: z.string().url().nullish(),
	type: z.string().default('manga'),
})

const trim = z.object({
	w: z.number().nullish(),
	h: z.number().nullish(),
	unit: z.enum(['mm', 'inch']).default('mm'),
})

const volume = z.object({
	slug: z.string(),
	link: z.string().url().nullish(),
	cover: z.string().url().nullish(),
	title: z.string().nullish(),
	staff: null_array(staff).nullish(),
	distributor: distributor.nullish(),
	imprint: distributor.nullish(),
	genres: null_array(z.string()).nullish(),
	maturity_rating: z.string().nullish(),
	description: z.string().nullish(),
	number: z.string().nullish(),
	isbn: z.string().nullish(),
	date: z.coerce.date().nullish(),
	price: null_array(currency).nullish(),
	pages: z.number().nullish(),
	trim: trim.nullish(),
})

const chapter = z.object({
	slug: z.string(),
	link: z.string().url().nullish(),
	cover: z.string().url().nullish(),
	title: z.string().nullish(),
	staff: null_array(staff).nullish(),
	distributor: distributor.nullish(),
	imprint: distributor.nullish(),
	genres: null_array(z.string()).nullish(),
	maturity_rating: z.string().nullish(),
	description: z.string().nullish(),
	number: z.string().nullish(),
	isbn: z.string().nullish(),
	date: z.coerce.date().nullish(),
	price: null_array(currency).nullish(),
	pages: z.number().nullish(),
	trim: trim.nullish(),
})

export const YenPressMangaBakaSeries = z.object({
	series_slug: z.string(),
	series_title: z.string(),
	series_is_chapter: z.boolean().default(false),
	series_main_slug: z.string().nullish(), // Infer by removing '-serial'
	link: z.string().url().nullish(),
	type: z.enum(['manga', 'manhwa', 'light novel', 'art book']),
	volume_count: z.number().nullish(),
	chapter_count: z.number().nullish(),
	cover: z.string().url().nullish(),
	staff: null_array(staff).nullish(),
	distributor: distributor,
	imprint: distributor.nullish(),
	genres: null_array(z.string()).nullish(), // Only in volume/chapter, copy over
	maturity_rating: z.string().nullish(), // Only in volume/chapter, copy over
	description: z.string().nullish(),
	volumes: null_array(volume).nullish(),
	chapters: null_array(volume).nullish(),
	related: null_array(related).nullish(),
})

export type YenPressMangaBakaSeries = z.infer<typeof YenPressMangaBakaSeries>

export const BookWalkerGlobalManga = z
	.object({
		'id': z.number(),
		'gid': z.number(),
		'info': z.object({
			genres: z
				.array(
					z.object({
						$t: z.string(),
						gid: z.number(),
						type: z.string(),
					}),
				)
				.nullish(),

			picture: z
				.array(
					z.object({
						gid: z.number(),
						img: z.array(
							z.object({
								src: z.string(),
								width: z.number(),
								height: z.number(),
							}),
						),
						src: z.string(),
						type: z.string(),
						width: z.number().nullable(),
						height: z.number().nullable(),
					}),
				)
				.nullish(),

			official_website: z
				.array(
					z.object({
						$t: z.string(),
						gid: z.number(),
						href: z.string(),
						lang: z.string(),
						type: z.string(),
					}),
				)
				.nullish(),

			main_title: z
				.object({
					$t: z.coerce.string(),
					gid: z.number(),
					lang: z.string().nullable().default(null),
					type: z.string(),
				})
				.nullish(),

			plot_summary: z
				.object({
					$t: z.string(),
					gid: z.number().nullish(),
					type: z.string(),
				})
				.nullish(),

			number_of_pages: z
				.object({
					$t: z.number(),
					gid: z.number(),
					type: z.string(),
				})
				.nullish(),

			alternative_title: z
				.array(
					z.object({
						$t: z.coerce.string(),
						gid: z.number(),
						lang: z.string(),
						type: z.string(),
					}),
				)
				.nullish(),

			objectionable_content: z
				.object({
					$t: z.string(),
					gid: z.number().nullish(),
					type: z.string(),
				})
				.nullish(),
		}),

		'name': z.coerce.string(),
		'type': z.string(),

		'staff': z
			.array(
				z.object({
					gid: z.number(),
					task: z.array(z.string()),
					person: z.array(z.object({ $t: z.coerce.string(), id: z.number() })),
				}),
			)
			.nullish(),

		'credit': z
			.array(
				z.object({
					gid: z.number(),
					task: z.array(z.string()),
					company: z.array(z.object({ $t: z.string(), id: z.number() })),
				}),
			)
			.nullish(),

		'ratings': z
			.object({
				nb_votes: z.number(),
				weighted_score: z.number(),
			})
			.nullish(),
	})
	.strict()

export type BookWalkerGlobalManga = z.infer<typeof BookWalkerGlobalManga>

/*export const volumeSchema = z.object({
  id: z.number(),
  links: z.array(z.string().url()),
  cover: z.string().url().nullable(), // Changed .nullish() to .nullable() for consistency if it truly means 'can be null'
  title: z.string(),
  writer: z.string(),
  artist: z.string(),
  distributor: distributor, // Using the imported or defined distributor schema/type
  maturity_rating: z.string(),
  description: z.string(),
  isbn10: z.string(),
  isbn13: z.string(),
  sku: z.string(),
  type: z.string().nullable(),
  volume: z.string().nullable(), // Renamed from 'volume' to avoid conflict with the schema name
  date: z.coerce.date(),
  price: z.string().nullable(),
  pages: z.string().nullable(),
})*/
