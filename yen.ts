import { string_to_date } from './date.js'
import { XMLParser } from 'fast-xml-parser'
import { YenPressMangaBakaSeries } from './yen.types.js'
import { http_request } from './runner.js'

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
						// Some series are lies
						const slug_match = /\d$|-novel$/i.exec(slug)
						if (slug_match) {
							continue
						}
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
	
	function extract_prices(prices: string): Record<string, string | null>[] | null {
		// Presumes there is always a US price first and Canandian one second
		if (prices === null) {
			return null
		}
		const price_split = prices?.split(' / ')
		const price_us = price_split?.[0]?.slice(1, -3) || null
		const price_can = price_split?.[1]?.slice(1, -3) || null

		if (price_us && price_can) {
			return [{'value': price_us, 'iso_code': 'usd'}, {'value': price_can, 'iso_code': 'cad'}]
		}
		return null
	}

	try {
		const url = 'https://yenpress.com/titles/' + slug
		const $ = await http_request(url)
		const series_data: Record<string, any> = {}
		const staff: Record<string, string | null>[] = []
		const works: Record<string, any>[] = []
		const paperback: Record<string, any> = {}
		const digital: Record<string, any> = {}
		const related: Record<string, any>[] = []

		const book_title_raw = $('div.heading-content .heading')?.text()
		const book_title_details = clean_series_title(book_title_raw)
		const series_title_raw = $('div.detail-info div.detail-box')?.first()?.children('p')?.text().trim()
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

		// Paperback/digital
		const tabs = $('div.buy-info div.tabs')?.text().trim().toLowerCase()
		const has_paperback = tabs.includes('paperback') || tabs.includes('audio')
		const has_digital = tabs.includes('digital')
		const book_details = $('section.book-details')
		const book_details_info = book_details.find('.detail-info')
		const prices_all = $('p.book-price')

		if (has_paperback && has_digital) {
			paperback['price'] = extract_prices(prices_all?.first()?.text())
			digital['price'] = extract_prices(prices_all?.last()?.text())
		}

		if (has_paperback && !has_digital) {
			paperback['price'] = extract_prices(prices_all?.first()?.text())
		}
		if (has_digital && !has_paperback) {
			digital['price'] = extract_prices(prices_all?.first()?.text())
		}

		// Paperback always first is there is one?
		for (const box of book_details_info.first().find('div.detail-box')?.children()) {
			const $box = $(box)
			// Only in paperback
			if ($box?.text().toLowerCase() == 'trim size') {
				const trim_split = $box?.next()?.text().trim()?.split('x')
					const w = Number(trim_split?.[0]?.replace('"', '')) || null
					const h = Number(trim_split?.[1]?.replace('"', '')) || null
					const w_mm = w? w * 25.4 : null
					const h_mm = h? h * 25.4 : null
					paperback['trim'] = {'w': w_mm, 'h': h_mm, 'unit': 'mm'}
			}
			if ($box?.text().toLowerCase() == 'age rating') {
				if (has_paperback) {
					paperback['maturity_rating'] = $box?.next()?.text().trim().replace(/\s\(.*\)$/, '')
				}
				if (has_digital) {
					digital['maturity_rating'] = $box?.next()?.text().trim().replace(/\s\(.*\)$/, '')
				}
			}
			if (tabs.startsWith('paperback') && $box?.text().toLowerCase() == 'page count') {
				paperback['pages'] = Number($box?.next()?.text().replace(' pages', '').trim()) || null
			}
			if (!has_paperback && has_digital && $box?.text().toLowerCase() == 'page count') {
				digital['pages'] = Number($box?.next()?.text().replace(' pages', '').trim()) || null
			}
			if (tabs.startsWith('paperback') && $box?.text().toLowerCase() == 'release date') {
				paperback['date'] = string_to_date($box?.next()?.text().trim())?.toJSDate() || null
			}
			if (!has_paperback && has_digital && $box?.text().toLowerCase() == 'release date') {
				digital['date'] = string_to_date($box?.next()?.text().trim())?.toJSDate() || null
			}
			if (!has_paperback && has_digital && $box?.text().toLowerCase() == 'isbn') {
				digital['isbn'] = $box?.next()?.text().trim()
			}
		}
		// If there is both, have to run second
		// Hate this but can't think of a better way atm
		if (has_paperback && has_digital) {
			for (const box of book_details_info.last().find('div.detail-box')?.children()) {
				const $box = $(box)
				if ($box?.text().toLowerCase() == 'page count') {
					digital['pages'] = Number($box?.next()?.text().replace(' pages', '').trim()) || null
				}
				if ($box?.text().toLowerCase() == 'release date') {
					digital['date'] = string_to_date($box?.next()?.text().trim())?.toJSDate() || null
				}
				if ($box?.text().toLowerCase() == 'isbn') {
					digital['isbn'] = $box?.next()?.text().trim()
				}
			}
		}
		// Imprint frequently div not tagged with class detail-box...
		const imprint = book_details.find('div.detail-info span:contains("Imprint")')?.first()?.next()?.text()

		const genres = book_details.find('div.detail-labels').first()?.children('a').map(function (i, ele) {
			return $(ele).text()
		}).toArray()

		if (has_paperback) {
			paperback['slug'] = slug
			paperback['title'] = series_title_details['series_subtitle']
			paperback['number'] = book_title_details['number']
			paperback['link'] = url
			paperback['cover'] = $('div.book-cover-img img')?.attr('data-src')
			paperback['isbn'] = slug?.slice(0, 13) || null
			paperback['distributor'] = {'name': 'Yen Press', 'link': 'https://yenpress.com'}
			paperback['imprint'] = {'name': imprint, 'link': imprints[imprint as keyof typeof imprints], 'imprint': true}
			paperback['description'] = $('.content-heading div.content-heading-txt p.paragraph')?.text()?.trim()
			paperback['staff'] = staff
			paperback['genres'] = genres
			works.push(paperback)
		}

		if (has_digital) {
			digital['slug'] = slug
			digital['title'] = series_title_details['series_subtitle']
			digital['number'] = book_title_details['number']
			digital['link'] = url
			digital['cover'] = $('div.book-cover-img img')?.attr('data-src')
			digital['distributor'] = {'name': 'Yen Press', 'link': 'https://yenpress.com'}
			digital['imprint'] = {'name': imprint, 'link': imprints[imprint as keyof typeof imprints], 'imprint': true}
			digital['description'] = $('.content-heading div.content-heading-txt p.paragraph')?.text()?.trim()
			digital['staff'] = staff
			digital['genres'] = genres
			digital['digital'] = true
			works.push(digital)
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

		series_data['related'] = related

		if (series_title_details['is_chapter']) {
			series_data['chapters'] = works
		} else {
			series_data['volumes'] = works
		}

		series_data['distributor'] = paperback['distributor'] || digital['distributor']
		series_data['imprint'] = paperback['imprint'] || digital['imprint']
		switch (imprint) {
			case 'Ize Press':
				series_data['type'] = 'manhwa'
				break
			case 'Yen Audio':
				series_data['type'] = 'audiobook'
				break
			default:
				series_title_details['type']
		}

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
	// We will take multiple bites at the title to make things easier
	const book_number = /.*(?:vol.|volume|chapter)\s(\d+.\d+|\d+)/i.exec(series_title)?.[1] || null
	// Will get overridden later if Ize imprint
	let series_type = /\s\(((.*?))\)/i.exec(series_title)?.[1] || null
	if (series_type === null) {
		series_type = 'manga'
	} else {
		// Check for allowed
		switch (series_type.toLowerCase()) {
			case 'manga':
			case 'light novel':
			case 'novel':
			case 'comic':
				series_title = series_title.replace('(' + series_type + ')', '')
				break
		}
	}
	series_type = series_type.toLowerCase()

	const series_title_main = /^(?<title>.*?)(?:\s(?:vol.|volume|chapter)\s(?<num>\d+.\d+|\d+))?(?:[:-]\s(?<subtitle>\w.*?))?$/i.exec(series_title)
	let series_title_clean: string = ''
	// let series_type: string = 'manga'
	let series_subtitle: string | null = null
	const is_chapter_series: boolean = series_title.toLowerCase().includes('chapter')
	if (series_title_main && series_title_main.groups) {
		series_title_clean = series_title_main.groups.title.trim()
		// series_type = series_title_main.groups.type || 'manga'
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
