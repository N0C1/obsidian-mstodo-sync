import en from './locale/en.json';
import zhCN from './locale/zh-cn.json';
import de from './locale/de.json';
import fr from './locale/fr.json';
import nl from './locale/nl.json';
import es from './locale/es.json';
import it from './locale/it.json';
import pt from './locale/pt.json';
import pl from './locale/pl.json';

export type Translations = Record<string, string>;

const localeMap: Record<string, Translations> = {
    en,
    'en-GB': en, // Yes I know it's not the same. But it's close enough.
    zh: zhCN,
    de,
    fr,
    nl,
    es,
    it,
    pt,
    pl,
};

export function getLocaleMap(): Record<string, Translations> {
    if (globalThis.localStorage.getItem('mstd_mock_localeMap')) {
        const mockLocaleMap = globalThis.localStorage.getItem('mstd_mock_localeMap');
        return mockLocaleMap ? JSON.parse(mockLocaleMap) : localeMap;
    }
    return localeMap;
}

function getLanguage(): string | null {
    return globalThis.localStorage.getItem('language');
}

function getLocale(language: string): Translations {
    const localeMap = getLocaleMap();
    return localeMap[language];
}

export function t(string_: string, params?: Record<string, string | number>): string {
    const language = getLanguage();
    const locale = getLocale(language ?? 'en');
    if (!locale) {
        console.error('Error: locale not found', language);
    }

    let translation = locale?.[string_] || string_;

    // Replace placeholders if params are provided
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            translation = translation.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
        }
    }

    return translation;
}
