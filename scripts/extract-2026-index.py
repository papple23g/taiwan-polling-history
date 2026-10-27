import json
import re
import sys
from typing import Any

from bs4 import BeautifulSoup


def discover_regions(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, 'html.parser')
    regions: list[dict[str, str]] = []
    for card in soup.select('[data-county-card]'):
        link = card.select_one('.card-h a')
        slug = card['data-county-card']
        if not re.fullmatch(r'[a-z]+(?:-[a-z]+)*', slug) or link is None or link.get('href') != f'/{slug}':
            raise ValueError('Unrecognized county card')
        regions.append({'slug': slug, 'name': link.get_text(' ', strip=True), 'url': f'https://poll-tw.com/{slug}'})
    if not regions or len({region['slug'] for region in regions}) != len(regions):
        raise ValueError('Missing or duplicate county cards')
    return regions


def inventory(pages: dict[str, str]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    regions: list[dict[str, Any]] = []
    for city, html in pages.items():
        soup = BeautifulSoup(html, 'html.parser')
        try:
            declared = soup.select_one('[data-list-n]')
            as_of = soup.select_one('meta[name="data-as-of"]')
            if declared is None or as_of is None:
                raise ValueError('Missing list count or data timestamp')
            city_records = extract({city: html})
            if int(declared.get_text(strip=True)) != len(city_records):
                raise ValueError('Declared and parsed wave counts differ')
            notice = soup.select_one('.pend')
            notice_text = notice.get_text(' ', strip=True) if notice else None
            hidden_match = re.search(r'另有\s*(\d+)\s*份民調', notice_text or '')
            if notice is not None and hidden_match is None:
                raise ValueError('Unrecognized hidden-record notice')
            regions.append({'slug': city, 'status': 'parsed', 'indexAsOf': as_of['content'],
                            'waveCount': len(city_records), 'questionCount': sum(len(row['questions']) for row in city_records),
                            'hiddenWaveCount': int(hidden_match[1]) if hidden_match else 0,
                            'hiddenNotice': notice_text})
            records.extend(city_records)
        except (ValueError, KeyError, AttributeError, TypeError, IndexError) as error:
            regions.append({'slug': city, 'status': 'parse_error', 'error': str(error),
                            'waveCount': None, 'questionCount': None, 'hiddenWaveCount': None})
    return {'regions': regions, 'records': records}


def extract(pages: dict[str, str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for city, html in pages.items():
        soup = BeautifulSoup(html, 'html.parser')
        for drawer in soup.select('section[data-drawer]'):
            metadata = {}
            for row in drawer.select('.kv'):
                spans = row.find_all('span', recursive=False)
                if len(spans) == 2:
                    metadata[spans[0].get_text(' ', strip=True)] = spans[1].get_text(' ', strip=True)
            questions = []
            for label in drawer.select('.mlabel'):
                block = label.parent
                responses = []
                for row in block.select('.res-r'):
                    spans = row.find_all('span', recursive=False)
                    value = row.select_one('.r.mono')
                    if value is None:
                        raise ValueError(f'Missing percentage: {drawer["data-drawer"]}')
                    responses.append({'label': spans[0].get_text(strip=True), 'percent': float(value.get_text(strip=True).rstrip('%'))})
                if not responses:
                    raise ValueError(f'Missing responses: {drawer["data-drawer"]}')
                link = block.select_one('.qsrc a')
                questions.append({'label': label.get_text(' ', strip=True), 'responses': responses, 'excerptSourceUrl': link.get('href') if link else None})
            if not questions:
                raise ValueError(f'Missing questions: {drawer["data-drawer"]}')
            records.append({
                'id': drawer['data-drawer'], 'city': city,
                'indexUrl': f'https://poll-tw.com/{city}?poll={drawer["data-drawer"]}',
                'indexAsOf': soup.select_one('meta[name="data-as-of"]')['content'],
                'executorLabel': drawer.select_one('.d-title').get_text(' ', strip=True),
                'metadata': metadata, 'questions': questions,
                'sources': [{'url': link['href'], 'title': link.get_text(' ', strip=True)} for link in drawer.select('a.src')],
            })
    return records


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    payload = json.load(sys.stdin)
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    result = discover_regions(payload) if mode == '--regions' else inventory(payload) if mode == '--inventory' else extract(payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))
