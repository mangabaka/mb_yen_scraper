import { string_to_date } from './date.js'
import { XMLParser, XMLBuilder, XMLValidator} from 'fast-xml-parser'
//import { Logger } from '$lib/logger'
//import SeriesNews from '$lib/server/models/SeriesNews.model'
import { YenPressMangaBakaSeries } from './yen.types.js'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { http_request } from './runner.js'
import { readFile } from 'fs/promises'
//import tracer, { type TraceOptions } from 'dd-trace'
//import { kinds } from 'dd-trace/ext'
//import tags from 'dd-trace/ext/tags'
import type { Job } from 'pg-boss'
import { ja, no, sl, tr } from 'zod/v4/locales'
import { AnyNode } from 'domhandler'
import { number, uuid } from 'zod/v4'
//import parser from 'xml2json'
//import SourceAnimeNewsNetwork from '../models/SourceAnimeNewsNetwork.model'
//import { Queue, QueueClient } from '../queue'

enum imprints {
	'Yen Press' = 'https://yenpress.com',
	'Yen On' = 'https://yenpress.com/imprint/yen-on',
	'JY' = 'https://yenpress.com/imprint/jy',
	'Yen Audio' = 'https://yenpress.com/imprint/yen-audio',
	'Ize Press' = 'https://yenpress.com/imprint/ize',
	'J-Novel Club' = 'https://yenpress.com/imprint/jnc',
}

export async function get_sitemap(): Promise<Record<string, any>> {
	// Parse sitemap for series and books

	const series: Record<string, any>[] = []
	const books: Record<string, any>[] = []
	
	const url: string = 'https://yenpress.com/sitemap.xml'
	try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
		const parser = new XMLParser()
		let data = parser.parse(await response.text(), true)
		
		for (const item of data?.urlset?.url) {
			if (item.loc.includes('series') || item.loc.includes('titles')) {
				const url = new URL (item.loc)
				const url_split = url.pathname.split('/')
				const type = url_split?.[1] || null
				const slug = url_split?.[2] || null
				const isbn = type == 'titles' ? slug?.slice(0, 13) : null
				// Might as well grab audiobooks?
				const is_audio = slug?.endsWith('audio')
				const is_chapter = slug?.includes('chapter') || slug?.includes('serial')

				if (type && slug) {
					if (type == 'series') {
						series.push({
							'slug': slug,
							'url': url.toString(),
							'type': type,
							'is_audio': is_audio,
							'is_chapter': is_chapter, // Should be able to infer volume by removing '-serial' from slug
						})
					} else if (type == 'titles') {
						books.push({
							'slug': slug,
							'url': url.toString(),
							'type': type,
							'isbn': isbn,
							'is_audio': is_audio,
							'is_chapter': is_chapter,
						})
					}
				}
			} else {
				continue
			}
			
		}

    return {'series': series, 'books': books}

  } catch (error) {
    console.error(`Error fetching Yen Press sitemap.xml`, error instanceof Error ? error.message : error);
    process.exit(1)
  }
}

export async function parse_book_page(slug: string): Promise<Record<string, any> | null> {
	if (!slug) {
		throw new Error('A slug is required')
	}
	
	try {
		const url = 'https://yenpress.com/titles/' + slug
		const $ = await http_request(url)
		const series_data: Record<string, any> = {}
		const staff: Record<string, string | null>[] = []
		const volumes: Record<string, any>[] = []
		const volume: Record<string, any> = {}
		const related: Record<string, any>[] = []

		const series_title_raw = $('div.heading-content .heading')?.text()
		const series_title_details = clean_series_title(series_title_raw)

		series_data['series_slug'] = $('a.main-btn')?.attr('href')?.replace('/series/', '')
		series_data['link'] = 'https://yenpress.com/series/' + series_data['series_slug']
		series_data['series_title'] = series_title_details['series_title']
		series_data['series_is_chapter'] = series_title_details['is_chapter']

		let series_main_slug = null
		if (series_title_details['is_chapter']) {
			// Infer "main" series slug
			series_main_slug = series_data['series_slug']?.replace('-serial', '')
		}
		series_data['series_main_slug'] = series_main_slug

		const staff_div = $('div.heading-content div.story-details')?.children('p')

		for (const s of staff_div) {
			const $s = $(s)
			const s_text = $s.text()
			const s_text_split = s_text.split(': ')
			// Need role and name
			if (s_text_split.length !== 2) {
				continue
			}
			const s_studio_split = s_text_split[1].split('(') || null
			const role = s_text_split[0]
			const name = s_studio_split && s_studio_split[0] ? s_studio_split[0] : s_text_split[1]
			const studio = s_studio_split?.[1]?.slice(0, -1) || null

			if (role && name) {
				staff.push({
					'role': role.toLowerCase().replace(' by', ''),
					'name': name,
					'studio': studio,
				})
			}
		}

		const prices = $('p.book-price').text()
		const prices_split = prices?.split(' / ')
		const price_us = prices_split?.[0]?.slice(1, -3) || null
		const price_can = prices_split?.[1]?.slice(1, -3) || null

		const book_details = $('section.book-details')
		// Imprint frequently div not tagged with class detail-box...
		const imprint = book_details.find('div.detail-info span:contains("Imprint")')?.next()?.text()

		const genres = book_details.find('div.detail-labels').first()?.children('a').map(function (i, ele) {
			return $(ele).text()
		}).toArray()
		const book_box_details = book_details.find('div.detail-box')?.children()
		for (const box of book_box_details) {
			const $box = $(box)
			switch ($box?.text().toLowerCase()) {
				case 'trim size':
					const trim_split = $box?.next()?.text().trim()?.split('x')
					const w = Number(trim_split?.[0]?.replace('"', '')) || null
					const h = Number(trim_split?.[1]?.replace('"', '')) || null
					const w_mm = w? w * 25.4 : null
					const h_mm = h? h * 25.4 : null
					volume['trim'] = {'w': w_mm, 'h': h_mm, 'unit': 'mm'}
					break
				case 'page count':
					volume['pages'] = Number($box?.next()?.text().replace(' pages', '').trim()) || null
					break
				case 'release date':
					volume['date'] = string_to_date($box?.next()?.text().trim())?.toJSDate() || null
					break
				case 'age rating':
					volume['maturity_rating'] = $box?.next()?.text().trim().replace(/\s\(.*\)$/, '')
			}
		}
		
		volume['slug'] = slug
		volume['title'] = series_title_details['series_subtitle']
		volume['number'] = series_title_details['number']
		volume['link'] = url
		volume['cover'] = $('div.book-cover-img img')?.attr('data-src')
		volume['isbn'] = slug?.slice(0, 13) || null
		volume['price'] = [{'value': price_us, 'iso_code': 'usd'}, {'value': price_can, 'iso_code': 'cad'}]
		volume['distributor'] = {'name': 'Yen Press', 'link': 'https://yenpress.com'}
		volume['imprint'] = {'name': imprint, 'link': imprints[imprint as keyof typeof imprints], 'imprint': true}
		volume['description'] = $('.content-heading div.content-heading-txt p.paragraph')?.text()?.trim()
		volume['staff'] = staff
		volume['genres'] = genres
		volumes.push(volume)

		const related_section = $('section.creators div.inner-slider-section').find('a')

		for (const r of related_section) {
			const $r = $(r)
			const r_href = $r.attr('href')
			const r_slug = r_href?.replace('/series/', '') || null
			if (!r_slug) {
				// Need a slug
				continue
			}
			const r_cover = $r.children('img')?.attr('src')
			const r_title = $r.last()?.text()?.trim()
			const r_title_details = clean_series_title(r_title)

			related.push({
				'slug': r_slug,
				'title': r_title_details['series_title'],
				'link': 'https://yenpress.com' + r_href,
				'cover': r_cover,
				'type': r_title_details['type'],
			})
		}

		series_data['related'] = related

		if (series_title_details['is_chapter']) {
			series_data['chapters'] = volumes
		} else {
			series_data['volumes'] = volumes
		}

		series_data['distributor'] = volume['distributor']
		series_data['imprint'] = volume['imprint']
		series_data['type'] = imprint == 'Ize Press' ? 'manhwa' : series_title_details['type']

		return YenPressMangaBakaSeries.strict().parse(series_data)

  } catch (error) {
    console.error(`Error fetching book ${slug} JSON:`, error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

export async function parse_series_page(slug: string): Promise<YenPressMangaBakaSeries> {
	if (!slug) {
		throw new Error('A slug is required')
	}
	
	try {
		const url = 'https://yenpress.com/series/' + slug
		const $ = await http_request(url)
		const series_data: Record<string, any> = {}
		const staff: Record<string, string | null>[] = []
		const volumes: Record<string, any>[] = []
		const related: Record<string, any>[] = []

		series_data['series_slug'] = slug
		const series_title_raw = $('div.heading-content .heading')?.text().slice(0, -1)
		const series_title_details = clean_series_title(series_title_raw)
		const series_title = series_title_details['series_title']
		const type = series_title_details['type']
		const series_is_chapter = series_title_details['is_chapter']
		let series_main_slug = null
		if (series_is_chapter) {
			// Infer "main" series slug
			series_main_slug = slug.replace('-serial', '')
		}
		const description = $('section.content-heading div.content-heading-txt p.paragraph').text().trim()
		const staff_div = $('div.heading-content div.story-details')?.children('p')

		for (const s of staff_div) {
			const $s = $(s)
			const s_text = $s.text()
			const s_text_split = s_text.split(': ')
			// Need role and name
			if (s_text_split.length !== 2) {
				continue
			}
			const s_studio_split = s_text_split[1].split('(') || null
			const role = s_text_split[0]
			const name = s_studio_split && s_studio_split[0] ? s_studio_split[0] : s_text_split[1]
			const studio = s_studio_split?.[1]?.slice(0, -1) || null

			if (role && name) {
				staff.push({
					'role': role.toLowerCase().replace(' by', ''),
					'name': name,
					'studio': studio,
				})
			}
		}

		const volumes_section = $('section#volumes-list div.category-thumbs-holder')?.find('a')

		for (const v of volumes_section) {
			const $v = $(v)
			const v_href = $v.attr('href')
			const v_slug = v_href?.replace('/titles/', '') || null
			if (!v_slug) {
				// Need a slug
				continue
			}
			const v_isbn = v_slug?.slice(0, 13) || null
			const v_cover = $v.children('img')?.attr('src')
			const v_title = $v.last()?.text()?.trim()
			const v_title_details = clean_series_title(v_title)

			volumes.push({
				'slug': v_slug,
				'title': v_title_details['series_subtitle'],
				'number': v_title_details['number'],
				'link': 'https://yenpress.com' + v_href,
				'cover': v_cover,
				'isbn': v_isbn,
			})
		}

		const related_section = $('section.creators div.inner-slider-section').find('a')

		for (const r of related_section) {
			const $r = $(r)
			const r_href = $r.attr('href')
			const r_slug = r_href?.replace('/series/', '') || null
			if (!r_slug) {
				// Need a slug
				continue
			}
			const r_cover = $r.children('img')?.attr('src')
			const r_title = $r.last()?.text()?.trim()
			const r_title_details = clean_series_title(r_title)

			related.push({
				'slug': r_slug,
				'title': r_title_details['series_title'],
				'link': 'https://yenpress.com' + r_href,
				'cover': r_cover,
				'type': r_title_details['type'],
			})
		}

		series_data['series_title'] = series_title
		series_data['link'] = url
		series_data['type'] = type
		series_data['cover'] = volumes?.[volumes.length -1]?.['cover'] // Use first volume/chapter cover as there is no "series" cover
		series_data['series_is_chapter'] = series_is_chapter
		series_data['series_main_slug'] = series_main_slug
		series_data['description'] = description
		series_data['distributor'] = {'name': 'Yen Press', 'link': 'https://yenpress.com'}
		series_data['staff'] = staff
		if (series_is_chapter) {
			// While volume length should be correct, chapters are removed once within a volume
			// The first chapter should be the "last" chapter, so use that number as best try
			series_data['chapters'] = volumes
			series_data['chapter_count'] = volumes?.[0]?.['number']
		} else {
			series_data['volumes'] = volumes
			series_data['volume_count'] = volumes.length
		}
		series_data['related'] = related

		return YenPressMangaBakaSeries.strict().parse(series_data)

	} catch (error) {
    console.error(`Error fetching book ${slug} JSON:`, error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

function clean_series_title(series_title: string): Record<string, any> {
	// The demon regex and I don't have a licence!
	const series_title_main = /^(?<title>.*?)(?:\s\((?<type>(.*?))\))?(?:,\s(?:vol.|chapter)\s(?<num>\d+.\d+|\d+))?(?:[:-]\s(?<subtitle>\w.*?))?$/i.exec(series_title)
	let series_title_clean: string = ''
	let series_type: string = 'manga'
	let book_number: string | null = null
	let series_subtitle: string | null = null
	const is_chapter_series: boolean = series_title.toLowerCase().includes('chapter')
	if (series_title_main && series_title_main.groups) {
		series_title_clean = series_title_main.groups.title
		series_type = series_title_main.groups.type || 'manga'
		book_number = series_title_main.groups.num || null
		series_subtitle = series_title_main.groups.subtitle || null
	}
	return {
		'series_title': series_title_clean,
		'series_subtitle': series_subtitle,
		'type': series_type,
		'number': book_number,
		'is_chapter': is_chapter_series
	}
}

/*
export function worker_produce(worker: QueueClient) {
	//const log = Logger.label('ann_news_schedule_refresh')

	const options: TraceOptions & tracer.SpanOptions = {
		tags: {
			[tags.MANUAL_KEEP]: true,
			[tags.SPAN_KIND]: kinds.PRODUCER,
			[tags.SPAN_TYPE]: 'worker',
		},
	}

	return tracer.wrap('ann_news_schedule_refresh', options, async () => {
		const rows = await SourceAnimeNewsNetwork.scope('due_for_update').findAll()
		if (rows.length == 0) {
			log.debug('No AnimeNewsNetwork entries due for news refresh')

			return
		}

		for (const row of rows) {
			log.info('AnimeNewsNetwork', row.id, 'will be scheduled for news refresh')

			await update_last_scheduled_at(row)
			await worker.send(Queue.news_ann_work, { id: row.id })
		}
	})
}

export async function worker_consume_batch(jobs: RefreshSeriesNewsPayload) {
	const log = Logger.label('ann_refresh_news_batch')
	log.info('Processing', jobs.length, 'jobs concurrently')

	await Promise.allSettled(
		jobs.map(async (job) => {
			try {
				await worker_consume([job])
				await QueueClient.Worker.boss.complete(Queue.news_ann_work.name, job.id)
			} catch (err) {
				await QueueClient.Worker.boss.fail(Queue.news_ann_work.name, job.id, err as object)
			}
		}),
	)

	log.info('Done processing', jobs.length, 'jobs concurrently')
}

export async function worker_consume([job]: RefreshSeriesNewsPayload) {
	const log = Logger.label(`ann_refresh_news`)

	const options: TraceOptions & tracer.SpanOptions = {
		tags: {
			[tags.MANUAL_KEEP]: true,
			[tags.SPAN_KIND]: kinds.CONSUMER,
			[tags.SPAN_TYPE]: 'worker',
			series: job.data,
		},
	}

	await tracer.trace('ann_refresh_news', options, async () => {
		// ! Don't wrap in a big transaction, it can be incredible slow and failing one entry
		// ! would undo all of them

		const row = await SourceAnimeNewsNetwork.findByPk(job.data.id)
		if (!row) {
			log.warn('could not find AnimeNewsNetwork row with ID', job.data.id)
			return
		}

		log.info('Updating AnimeNewsNetwork entry [', row.id, ']')

		await refresh_news(row)
	})
}

function update_last_scheduled_at(row: SourceAnimeNewsNetwork) {
	row.last_scheduled_at = new Date()
	return row.save()
}

export async function worker_consume_discover_new_entries() {
	const log = Logger.label(`worker_consume_discover_new_entries`)

	const resp = await axios.get(`https://www.animenewsnetwork.com/encyclopedia/reports.xml?id=149`)
	const result = parser.toJson(resp.data, { object: true, coerce: true })
	const report = result.report as { item: any[] }

	for (const item of report.item as any[]) {
		const id = item.manga.href.split('?id=')[1]
		if (!id) {
			log.warn('Could not find ID for encyclopedia entry')
			continue
		}

		const [, created] = await SourceAnimeNewsNetwork.findOrCreate({
			where: { id },
		})

		if (created) {
			log.info('Discovered new ANN encyclopedia entry', id)
		}
	}
}
*/