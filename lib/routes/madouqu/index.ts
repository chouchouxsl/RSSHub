import { Route } from '@/types';
import ofetch from '@/utils/ofetch'; // 统一使用的请求库
import { load } from 'cheerio';
import cache from '@/utils/cache';

const host = 'https://madouqu.com/';

export const route: Route = {
    path: '/',
    categories: ['programming'],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: true,
        supportPodcast: false,
        supportScihub: true,
    },
    name: 'madouqu',
    maintainers: ['Rzz'],
    handler,
};

async function handler(ctx) {
    const url = `${host}`;

    const data = await ofetch(url);

    const $ = load(data);

    const list = $('.site-main .posts-wrapper .post')
        .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 30)
        .toArray()
        .map((item) => {
            item = $(item);
            return {
                title: item.find('.entry-title a').text().trim(),
                link: item.find('.entry-title a').attr('href'),
                cover: item.find('.entry-media img').attr('data-src'),
            };
        });

    const items = await fetchDoc(list);

    console.log('🤪 items >>:', items);

    console.log('🤪 over ~');

    return {
        // 源标题
        title: `Madouqu`,
        // 源链接
        link: url,
        // 源文章
        item: items,
    };
}

async function fetchDoc(list: any[]) {
    return await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                const data = await ofetch(item.link);
                const $ = load(data);

                const warp = $('<div style="width: 100%;"></div>');

                warp.append($('<h2>预览图片</h2>'));

                if (item.cover) {
                    warp.append($(`<img src="${item.cover}" style="width: 100%;">`));
                }

                warp.append($('<h2>主要内容</h2>'));

                const PS = $('.entry-content').find('p').slice(-4);

                warp.append($(PS));

                PS.toArray().forEach((P, I) => {
                    if (I == 1) {
                        const author = $(P).text();
                        item.author = author;
                    }

                    if (I == 3) {
                        const str = $(P).text().split('：')[1].trim();
                        const date = parseDateString(str);
                        item.pubDate = date;
                    }
                });

                item.description = warp.html();

                return item;
            })
        )
    );
}

function parseDateString(dateString) {
    const currentYear = new Date().getFullYear();
    const regex = /(\d{1,2})月(\d{1,2})日 (\d{1,2}):(\d{1,2})/;
    const match = dateString.match(regex);

    if (match) {
        const month = parseInt(match[1], 10) - 1; // 月份是从0开始计数的，需要减1
        const day = parseInt(match[2], 10);
        const hours = parseInt(match[3], 10);
        const minutes = parseInt(match[4], 10);

        // 创建一个新的 Date 对象
        const dateObject = new Date(currentYear, month, day, hours, minutes);

        return dateObject;
    } else {
        console.log('时间字符串格式不正确');
        return null; // 或者抛出错误，视情况而定
    }
}
