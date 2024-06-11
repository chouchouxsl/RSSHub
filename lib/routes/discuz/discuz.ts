import { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import iconv from 'iconv-lite';
import { parseDate } from '@/utils/parse-date';
import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';

function fixUrl(itemLink, baseUrl) {
    // 处理相对链接
    if (itemLink) {
        if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
            baseUrl = /^\/\//.test(baseUrl) ? 'http:' + baseUrl : 'http://' + baseUrl;
        }
        itemLink = new URL(itemLink, baseUrl).href;
    }
    return itemLink;
}

// discuz 7.x 与 discuz x系列 通用文章内容抓取
async function loadContent(itemLink, charset, header) {
    // 处理编码问题
    const response = await got({
        method: 'get',
        url: itemLink,
        responseType: 'buffer',
        headers: header,
    });

    const responseData = iconv.decode(response.data, charset ?? 'utf-8');
    if (!responseData) {
        const description = '获取详细内容失败';
        return { description };
    }

    const $ = load(responseData);

    const post = $('div#postlist div[id^=post] td[id^=postmessage]').first();

    // fix lazyload image
    post.find('img').each((_, img) => {
        img = $(img);
        if (img.attr('src')?.endsWith('none.gif') && img.attr('file')) {
            img.attr('src', img.attr('file') || img.attr('zoomfile'));
            img.removeAttr('file');
            img.removeAttr('zoomfile');
        }
    });

    // 只抓取论坛1楼消息
    const description = post.html();

    return { description };
}

export const route: Route = {
    path: ['/:ver{[7xz]}/:cid{[0-9]{2}}/:link{.+}', '/:ver{[7xz]}/:link{.+}', '/:link{.+}'],
    name: 'Unknown',
    maintainers: [],
    handler,
};

async function handler(ctx) {
    let link = ctx.req.param('link');
    const ver = ctx.req.param('ver') ? ctx.req.param('ver').toUpperCase() : undefined;
    const cid = ctx.req.param('cid');
    link = link.replace(/:\/\//, ':/').replace(/:\//, '://');

    const cookie =
        cid === undefined
            ? '4fJN_2132_ulastactivity=e4e0USXSBwO1OJuLee%2B9TME6uN9TXYYTC11cLtXi1Gt%2FdP%2FrGpcd;4fJN_2132_auth=59a6PFqBdTD38qqpKXiW%2Fes8ZrKOiAzWEL5G%2FBJQl0K%2BvGg%2F8vwgVlBoSZyxt1MUe09%2B7uO8PSWfvzjjTjmQF319%2FA;4fJN_2132_lastcheckfeed=37275%7C1700921095;existmag=mag;4fJN_2132_visitedfid=2D36;4fJN_2132_saltkey=f1dd33cC;4fJN_2132_lastvisit=1700903356;4fJN_2132_forum_lastvisit=D_2_1701326821;4fJN_2132_smile=4D1;4fJN_2132_sid=MttGgW;4fJN_2132_lastact=1701326821%09forum.php%09forumdisplay;4fJN_2132_checkpm=1;4fJN_2132_lip=66.90.115.138%2C1701087829;4fJN_2132_onlineusernum=8567;4fJN_2132_sendmail=1;4fJN_2132_st_t=37275%7C1701326821%7C42d3f509f2d05db2cdb9838a30afdf8a'
            : config.discuz.cookies[cid];
    if (cookie === undefined) {
        throw new ConfigNotFoundError('缺少对应论坛的cookie.');
    }

    const headers = {
        Cookie: cookie,
    };

    const response = await got({
        method: 'get',
        url: link,
        responseType: 'buffer',
        headers,
    });

    const responseData = response.data;
    // 若没有指定编码，则默认utf-8

    console.log('🤪 response.headers >>:', response);
    const contentType = response.headers ? response?.headers['content-type'] : '';
    let $ = load(iconv.decode(responseData, 'utf-8'));
    const charset = contentType.match(/charset=([^;]*)/)?.[1] ?? $('meta[charset]').attr('charset') ?? $('meta[http-equiv="Content-Type"]').attr('content')?.split('charset=')?.[1];
    if (charset?.toLowerCase() !== 'utf-8') {
        $ = load(iconv.decode(responseData, charset ?? 'utf-8'));
    }

    const version = ver ? `DISCUZ! ${ver}` : $('head > meta[name=generator]').attr('content');

    let items;
    if (version.toUpperCase().startsWith('DISCUZ! 7')) {
        // discuz 7.x 系列
        // 支持全文抓取，限制抓取页面5个
        const list = $('tbody[id^="normalthread"] > tr')
            .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 5)
            .toArray()
            .map((item) => {
                item = $(item);
                const a = item.find('span[id^=thread] a');
                return {
                    title: a.text().trim(),
                    link: fixUrl(a.attr('href'), link),
                    pubDate: item.find('td.author em').length ? parseDate(item.find('td.author em').text().trim()) : undefined,
                    author: item.find('td.author cite a').text().trim(),
                };
            });

        items = await Promise.all(
            list.map((item) =>
                cache.tryGet(item.link, async () => {
                    const { description } = await loadContent(item.link, charset, headers);

                    item.description = description;
                    return item;
                })
            )
        );
    } else if (version.toUpperCase().startsWith('DISCUZ! X')) {
        // discuz X 系列
        // 支持全文抓取，限制抓取页面5个
        const list = $('tbody[id^="normalthread"] > tr')
            .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 5)
            .toArray()
            .map((item) => {
                item = $(item);
                const a = item.find('a.xst');
                return {
                    title: a.text(),
                    link: fixUrl(a.attr('href'), link),
                    pubDate: item.find('td.by:nth-child(3) em span').last().length ? parseDate(item.find('td.by:nth-child(3) em span').last().text().trim()) : undefined,
                    author: item.find('td.by:nth-child(3) cite a').text().trim(),
                };
            });

        items = await Promise.all(
            list.map((item) =>
                cache.tryGet(item.link, async () => {
                    const { description } = await loadContent(item.link, charset, headers);

                    item.description = description;
                    return item;
                })
            )
        );
    } else if (version.toUpperCase().startsWith('DISCUZ! Z')) {
        // http://localhost:1200/discuz/z/https%3A%2F%2Fwww.javbus.com%2Fforum%2Fforum.php%3Fmod%3Dforumdisplay%26fid%3D36?image_hotlink_template=https://bus.15146018521.workers.dev/$%7Bprotocol%7D//$%7Bhost%7D$%7Bpathname%7D
        // console.log('🤪 link >>:', link);
        const listDom = $('tbody[id^="normalthread"]');

        const list = listDom
            .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 30)
            .toArray()
            .map((item) => {
                item = $(item);
                const $s = item.find('.post_inforight .post_infolist_tit .s');
                const $t = item.find('.post_inforight .post_infolist_other .time');
                const pubDate = parseDate($t.find('span[title]').attr('title').trim());
                const author = $t.find('a').text().trim();
                return {
                    title: $s.text(),
                    link: fixUrl($s.attr('href'), link),
                    author,
                    pubDate,
                };
            });
        items = await Promise.all(
            list.map((item) =>
                cache.tryGet(item.link, async () => {
                    const { description } = await loadContent(item.link, charset, headers);

                    item.description = description;
                    return item;
                })
            )
        );
    } else {
        throw new InvalidParameterError('不支持当前Discuz版本.');
    }

    return {
        title: $('head > title').text(),
        description: $('head > meta[name=description]').attr('content'),
        link,
        item: items,
    };
}
