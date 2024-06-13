import { Route } from '@/types';
import cache from '@/utils/cache';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';
import puppeteer from '@/utils/puppeteer';
import logger from '@/utils/logger';
import { getCookies } from '@/utils/puppeteer-utils';

const confirmButton = 'a.enter-btn';
const threadlisttableid = '#threadlisttableid tbody[id^=normalthread]';
const postmessage = "td[id^='postmessage']";

let cookies = void 0;

const host = 'https://www.sehuatang.net/';

const forumIdMaps = {
    // 原创 BT 电影
    gcyc: '2', //     国产原创
    yzwmyc: '36', //  亚洲无码原创
    yzymyc: '37', //  亚洲有码原创
    gqzwzm: '103', // 高清中文字幕
    sjxz: '107', //   三级写真
    vr: '160', //     VR 视频
    srym: '104', //   素人有码
    omwm: '38', //    欧美无码
    '4k': '151', //   4K 原版
    hgzb: '152', //   韩国主播
    dmyc: '39', //    动漫原创
    // 色花图片
    yczp: '155', //   原创自拍
    ztzp: '125', //   转贴自拍
    hrjp: '50', //    华人街拍
    yzxa: '48', //    亚洲性爱
    omxa: '49', //    欧美性爱
    ktdm: '117', //   卡通动漫
    ttxz: '165', //   套图下载

    zhtl: '95', //    综合讨论
    // no longer updated/available
    mrhj: '106', //   每日合集
    ai: '113', //     AI 换脸电影
    ydsc: '111', //   原档收藏 WMV
    hrxazp: '98', //  华人性爱自拍
};

export const route: Route = {
    path: ['/bt/:subforumid?', '/picture/:subforumid', '/:subforumid?/:type?', '/:subforumid?', ''],
    name: 'Unknown',
    maintainers: ['qiwihui', 'junfengP', 'nczitzk'],
    handler,
    description: `**原创 BT 电影**

  | 国产原创 | 亚洲无码原创 | 亚洲有码原创 | 高清中文字幕 | 三级写真 | VR 视频 | 素人有码 | 欧美无码 | 韩国主播 | 动漫原创 | 综合讨论 |
  | -------- | ------------ | ------------ | ------------ | -------- | ------- | -------- | -------- | -------- | -------- | -------- |
  | gcyc     | yzwmyc       | yzymyc       | gqzwzm       | sjxz     | vr      | srym     | omwm     | hgzb     | dmyc     | zhtl     |

  **色花图片**

  | 原创自拍 | 转贴自拍 | 华人街拍 | 亚洲性爱 | 欧美性爱 | 卡通动漫 | 套图下载 |
  | -------- | -------- | -------- | -------- | -------- | -------- | -------- |
  | yczp     | ztzp     | hrjp     | yzxa     | omxa     | ktdm     | ttxz     |`,
};

const fetchDesc = (list, browser) =>
    Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                logger.http(`Requesting ${item.link}`);

                const page = await browser.newPage();
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    request.resourceType() === 'document' || request.resourceType() === 'script' ? request.continue() : request.abort();
                });
                await page.goto(item.link, {
                    waitUntil: 'networkidle2',
                    referer: host,
                });
                const content = await page.content();
                await page.close();

                const $ = load(content);
                const postMessage = $(postmessage).slice(0, 1);

                const images = $(postMessage).find('img');

                for (const image of images) {
                    const file = $(image).attr('file');
                    if (!file || file === 'undefined') {
                        $(image).replaceWith('');
                    } else {
                        $(image).replaceWith($(`<img src="${file}">`));
                    }
                }
                // if postMessage does not have any images, try to parse image url from `.pattl`
                if (images.length === 0) {
                    const pattl = $('.pattl');
                    const pattlImages = $(pattl).find('img');
                    for (const pattlImage of pattlImages) {
                        const file = $(pattlImage).attr('file');
                        if (!file || file === 'undefined') {
                            $(pattlImage).replaceWith('');
                        } else {
                            $(pattlImage).replaceWith($(`<img src="${file}" />`));
                        }
                    }
                    postMessage.append($(pattl));
                }

                $('em[onclick]').remove();

                const magnetTags = postMessage
                    .find('div.blockcode li')
                    .toArray()
                    .map((item) => {
                        const magnet = $(item).text();
                        const isMag = magnet.startsWith('magnet');
                        if (isMag) {
                            item.enclosure_url = magnet;
                            item.enclosure_type = 'application/x-bittorrent';
                        }
                        return `<div><a href="${magnet}">${magnet}</a></div>`;
                    });

                if (magnetTags.length) {
                    postMessage.find('div.blockcode').html(magnetTags);
                }

                $('.pattl')
                    .find('p.attnm a')
                    .toArray()
                    .forEach((torrent) => {
                        const fileName = $(torrent).text();
                        if (fileName) {
                            postMessage.append(`<div><a href="${$(torrent).attr('href')}">${fileName}</a></div>`);
                        }
                    });

                const otherInfo = postMessage.html()?.replace(/ignore_js_op/g, 'div');

                if (otherInfo) {
                    item.pubDate = timezone(parseDate($('.authi em span').attr('title')), 8);
                    item.description = otherInfo;
                } else {
                    item.description = '<h1>抓取内容失败 !</h1>';
                }

                return item;
            })
        )
    );

async function handler(ctx) {
    const subformName = ctx.req.param('subforumid') ?? 'gqzwzm';
    const subformId = subformName in forumIdMaps ? forumIdMaps[subformName] : subformName;
    const type = ctx.req.param('type');
    const typefilter = type ? `&filter=typeid&typeid=${type}` : '';
    const link = `${host}forum.php?mod=forumdisplay&orderby=dateline&fid=${subformId}${typefilter}`;

    const browser = await puppeteer({ stealth: true });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (request) => {
        request.resourceType() === 'document' || request.resourceType() === 'script' ? request.continue() : request.abort();
    });

    logger.http(`Requesting ${link}`);

    await page.goto(link, {
        waitUntil: 'networkidle0',
        referer: host,
    });

    // 等待类名为 confirmButton 的按钮出现
    await page.waitForSelector(confirmButton, { visible: true });
    const button = await page.$(confirmButton); // 获取按钮元素
    if (!button) {
        return '<h1>bbbbbb</h1>';
    }
    await Promise.all([button.click(), page.waitForNavigation({ waitUntil: 'networkidle0' })]);
    // 等待内容展示
    await page.waitForSelector(threadlisttableid, { visible: true });
    // 获取跳转后页面的内容
    const content = await page.content();
    cookies = await getCookies(page);
    console.log('🤪 cookies >>:', cookies);

    const $ = load(content);

    const list = $(threadlisttableid)
        .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 15)
        .toArray()
        .map((item) => {
            item = $(item);
            const hasCategory = item.find('th em a').length;
            return {
                title: `${hasCategory ? `[${item.find('th em a').text()}]` : ''} ${item.find('a.xst').text()}`,
                link: host + item.find('a.xst').attr('href'),
                pubDate: parseDate(item.find('td.by').find('em span span').attr('title')),
                author: item.find('td.by cite a').first().text(),
            };
        });

    const items = await fetchDesc(list, browser);

    const title = `色花堂 - ${$('#pt > div:nth-child(1) > a:last-child').text()}`;

    await browser.close();

    return {
        title,
        link,
        item: items,
    };
}
