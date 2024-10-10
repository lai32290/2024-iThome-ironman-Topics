const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'cache');
const BATCH_SIZE = 15;

// 為 URL 創建哈希值的函數
function hashUrl(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

// 檢查頁面是否在緩存中的函數
function checkCache(url) {
  const hash = hashUrl(url);
  const cachePath = path.join(CACHE_DIR, `${hash}.html`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf8');
  }
  return null;
}

// 將頁面保存到緩存的函數
function saveToCache(url, content) {
  const hash = hashUrl(url);
  const cachePath = path.join(CACHE_DIR, `${hash}.html`);
  fs.writeFileSync(cachePath, content);
}

// 從 URL 中移除 "#ir-list" 的函數
function cleanUrl(url) {
  return url.replace(/#ir-list$/, '');
}

async function crawlIThome() {
  try {
    console.log('開始爬蟲...');
    
    // 如果緩存目錄不存在，則創建它
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR);
    }

    const mainUrl = 'https://ithelp.ithome.com.tw/2024ironman/';
    console.log(`訪問主頁：${mainUrl}`);
    
    let content = checkCache(mainUrl);
    if (!content) {
      const response = await axios.get(mainUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://ithelp.ithome.com.tw/'
        },
        timeout: 5000 // 5 秒超時
      });
      content = response.data;
      saveToCache(mainUrl, content);
    } else {
      console.log('從緩存加載主頁。');
    }

    console.log('提取類別...');
    const $ = cheerio.load(content);
    const categories = [];

    // 提取類別
    $('.class-bar-item').each((index, element) => {
      const categoryName = $(element).find('a').text().trim();
      let categoryUrl = $(element).find('a').attr('href');
      categoryUrl = cleanUrl(categoryUrl);  // 移除 "#ir-list"
      // 跳過 "ALL" 類別
      if (categoryName.toLowerCase() !== 'all') {
        categories.push({ name: categoryName, url: categoryUrl, series: [] });
      }
    });

    console.log(`找到 ${categories.length} 個類別。`);

    // 從頁面提取系列的函數
    async function extractSeriesFromPage(url) {
      url = cleanUrl(url);  // 如果存在，移除 "#ir-list"
      console.log(`訪問：${url}`);
      let content = checkCache(url);
      if (!content) {
        const pageResponse = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          }
        });
        content = pageResponse.data;
        saveToCache(url, content);
      } else {
        console.log(`從緩存加載頁面：${url}`);
      }

      const $page = cheerio.load(content);
      const series = [];

      $page('.articles-box').each((i, element) => {
        const seriesTitle = $page(element).find('.articles-topic a').text().trim();
        const seriesUrl = $page(element).find('.articles-topic a').attr('href');
        if (seriesTitle && seriesUrl) {
          series.push({ title: seriesTitle, url: seriesUrl });
        }
      });

      console.log(`從 ${url} 提取了 ${series.length} 個系列`);
      return series;
    }

    // 處理一個類別的所有頁面的函數
    async function processCategoryPages(category, index, total) {
      console.log(`提取類別的系列：${category.name} (${index + 1}/${total})`);
      
      let pageNum = 1;
      let allSeries = [];
      let hasMorePages = true;

      while (hasMorePages) {
        const pagesToProcess = [];
        for (let i = 0; i < BATCH_SIZE && hasMorePages; i++) {
          pagesToProcess.push(`${category.url}?page=${pageNum}`);
          pageNum++;
        }

        const results = await Promise.all(pagesToProcess.map(url => extractSeriesFromPage(url)));
        const newSeries = results.flat();

        if (newSeries.length === 0) {
          hasMorePages = false;
        } else {
          allSeries = allSeries.concat(newSeries);
          console.log(`  處理了 ${pagesToProcess.length} 頁。系列總數：${allSeries.length}`);
        }
      }

      // 移除重複項
      const uniqueSeries = allSeries.filter((series, index, self) =>
        index === self.findIndex((t) => t.url === series.url)
      );

      category.series = uniqueSeries;

      console.log(`完成 ${category.name} 的提取。唯一系列總數：${category.series.length}`);
    }

    // 處理所有類別
    for (let i = 0; i < categories.length; i++) {
      await processCategoryPages(categories[i], i, categories.length);
    }

    console.log('所有類別處理完畢。準備 Markdown 文件...');

    // 準備 Markdown 文件內容
    let fileContent = '# 按類別的系列 - iThome 鐵人賽\n\n';
    categories.forEach(category => {
      fileContent += `## ${category.name}\n\n`;
      category.series.forEach(series => {
        fileContent += `- [${series.title}](${series.url})\n`;
      });
      fileContent += '\n';
    });

    // 保存 Markdown 文件
    fs.writeFileSync('topics.md', fileContent);
    console.log('按類別的系列已保存到 topics.md');
    console.log('過程成功完成！');

  } catch (error) {
    console.error('發生錯誤：', error.message);
    if (error.response) {
      console.error('響應狀態：', error.response.status);
      console.error('響應頭：', error.response.headers);
    }
  }
}

crawlIThome();