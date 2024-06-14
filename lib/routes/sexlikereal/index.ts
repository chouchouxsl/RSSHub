import { Route } from '@/types';
import ofetch from '@/utils/ofetch'; // 统一使用的请求库
import { parseRelativeDate } from '@/utils/parse-date';
import { load } from 'cheerio';
import cache from '@/utils/cache';

const host = 'https://www.sexlikereal.com';

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
    name: 'sexlikereal',
    maintainers: ['Rzz'],
    handler,
};

async function handler(ctx) {
    const url = `${host}/scenes?type=premium&sort=most_recent`;

    const data = await ofetch(url);

    const $ = load(data);

    const list = $('.c-grid--scenes article.c-grid-item--scene')
        .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 30)
        .toArray()
        .map((item) => {
            item = $(item);
            return {
                title: item.find('a.c-grid-item-footer-title').text().trim(),
                link: `${host}${item.find('a.c-grid-item-footer-title').attr('href')}`,
                pubDate: parseRelativeDate(item.find('span[data-qa=scenes-grid-item-published]').text()),
                preview: item.find('img[data-videosrc]').attr('data-videosrc'),
            };
        });

    const items = await fetchDoc(list);

    console.log('🤪 over ~');

    return {
        // 源标题
        title: `Sex Liker Real`,
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

                const images = $('#tabs-photos').find('.mediabox-img');

                for (const image of images) {
                    const imgUrl = $(image).attr('data-srcset');
                    console.log('🤪 imgUrl >>:', imgUrl);
                    warp.append($(`<img src="${imgUrl}" style="width: 100%;">`));
                }

                warp.append($('<h2>预览视频</h2>'));

                if (item.preview) {
                    console.log('🤪 videoUrl >>:', item.preview);
                    warp.append($(`<video src="${item.preview}" style="width: 100%;">`));
                }

                warp.append($('<h2>演员列表</h2>'));

                const authors = $('div[data-qa=scene-model-list] div[data-qa=scene-model-list-item]');
                const authorsList: any[] = [];
                const authorsWarp = $('<div style="display: flex;align-items: center;"></div>');
                for (const author of authors) {
                    const name = $(author).find('a[data-qa=scene-model-list-item-name]').text();
                    const avatar = $(author).find('img[data-qa=scene-model-list-item-photo-img]').attr('data-src');
                    const link = $(author).find('a[data-qa=scene-model-list-item-name]').attr('href');
                    authorsList.push(name);
                    console.log('🤪 author >>:', name, avatar, link);
                    authorsWarp.append(
                        $(`
                      <a href="${host}${link}">
                        <p><img src="${avatar}" style="width: 30px;"></p>
                        <p>${name}</p>
                      <a>
                    `)
                    );
                }
                warp.append(authorsWarp);

                warp.append($('<h2>工作室</h2>'));

                const studio = $('a[data-qa^=page-scene-studio-link]');

                const studioName = $(studio).attr('data-amplitude-props-studio-name');
                const studioLink = $(studio).attr('href');

                console.log('🤪 studio >>:', studioName, studioLink);

                warp.append($(`<p><a href="${host}${studioLink}">${studioName}</a></p>`));

                warp.append($('<h2>BT下载</h2>'));

                const mLink = `https://btdig.com/search?order=0&q=${encodeURIComponent(item.title)}`;

                warp.append($(`<p><a href="${mLink}">点击跳转</a></p>`));

                item.description = warp.html();
                item.author = authorsList.join(',');

                return item;
            })
        )
    );
}
