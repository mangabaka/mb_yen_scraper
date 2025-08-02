import { get_sitemap, parse_series_page, parse_book_page } from './yen.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFile } from 'fs/promises';
import { URLSearchParams } from 'url'; // Node.js built-in module
import { tr } from 'zod/v4/locales';

async function saveJsonToFileAsync(data: any, path: string) {
  try {
    const jsonString = JSON.stringify(data, null, 2);

    await writeFile(path, jsonString, 'utf8');
    console.log(`JSON data successfully saved to ${path} (async).`);
  } catch (error) {
    console.error(`Error saving JSON data to ${path} (async):`, error);
  }
}

export async function http_request(url: string = ''): Promise<cheerio.CheerioAPI> {
    try {
        const response = await axios.get(url, {
            maxRedirects: 1,
        })

        if (response.status !== 200) {
            throw new Error(`Failed to retrieve the web page - got response code [${response.status}] for URL [${url}]`)
        }

        console.log('Successfully fetched URL. Loading with Cheerio...')
        return cheerio.load(response.data)
    } catch (error: any) {
        console.error('An error occurred during parsing:')
        if (error.response) {
            console.error(`Status: ${error.response.status}`)
            console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`)
        } else if (error instanceof Error) {
            console.error(`Error: ${error.message}`)
        } else {
            console.error(error)
        }
        process.exit(1)
    }
    
}

/*async function get_volume(id: string): Promise<void> {
    // Fetches volume/chapter information from (de)UUID webpage
    if (!id) {
        console.error('Usage: ts-node activate_parser.ts <ID>')
        process.exit(1)
    }

    console.log(`Attempting to fetch and parse ID: ${id}`)
    const url = 'https://global.bookwalker.jp/de' + id

    const $ = await http_request(url)

    console.log(`Parsing page with ID: ${id}`)
    const parsedData = await bwg_parse_page($, id)

    console.log('Parsing complete for ID: ${id}')
    const file_path = './data/manga_' + id + '.json'
    saveJsonToFileAsync(parsedData, file_path)
}*/

/*async function runParser(id: string, isVolume: boolean = true): Promise<void> {
    if (!id) {
        console.error('Usage: ts-node activate_parser.ts <ID>');
        process.exit(1);
    }

    console.log(`Attempting to fetch and parse ID: ${id}`);
    const url = 'https://global.bookwalker.jp/' + id

    try {
        const response = await axios.get(url, {
            maxRedirects: 1,
        });

        if (response.status !== 200) {
            throw new Error(`Failed to retrieve the web page - got response code [${response.status}] for URL [${url}]`);
        }

        console.log('Successfully fetched URL. Loading with Cheerio...')
        const $ = cheerio.load(response.data)

        console.log(`Parsing page with ID: ${id}`)
        const parsedData = await bwg_parse_page($, id, isVolume)

        console.log('Parsing complete for ID: ${id}')
        const file_path = './data/manga_' + id + '.json'
        saveJsonToFileAsync(parsedData, file_path)
    } catch (error: any) {
        console.error('An error occurred during parsing:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
        } else if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error(error); // Fallback for unexpected error types
        }
        process.exit(1);
    }
}*/

// Get the URL from command line arguments
const cmd = process.argv[2]
const slug = process.argv[3]

if (cmd == 'sitemap') {
    const sitemap = await get_sitemap()
    const file_path = './data/sitemap_' + Date.now().toString() + '.json'
    saveJsonToFileAsync(sitemap, file_path)
} else if (cmd == 'series') {
    const series_details = await parse_series_page(slug)
    const file_path = './data/series_' + slug + '.json'
    saveJsonToFileAsync(series_details, file_path)
} else if (cmd == 'book') {
    const book_details = await parse_book_page(slug)
    const file_path = './data/book_' + slug + '.json'
    saveJsonToFileAsync(book_details, file_path)
}
