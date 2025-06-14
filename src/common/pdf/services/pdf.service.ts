import { Injectable } from '@nestjs/common';
import * as ejs from 'ejs';
import * as puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { join } from 'path';
import { promises as fs } from 'fs';
import { PDFOptions } from 'puppeteer';

@Injectable()
export class PdfService {
  async generatePdf(data: any, templateName: string): Promise<Buffer> {
    const templatePath = join(
      __dirname,
      '..',
      '..',
      '..',
      'assets',
      'templates',
      `${templateName}.ejs`,
    );
    const template = await fs.readFile(templatePath, 'utf8');

    const imagePath = join(
      __dirname,
      '..',
      '..',
      '..',
      'assets',
      'images',
      'logo.png',
    );
    const imageBase64 = await this.imageToBase64(imagePath);

    const html = ejs.render(template, { ...data, logo: imageBase64 });
    const browser = await puppeteer.launch({
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html);
    const stylesheets = await this.getStylesheets(html);
    for (const stylesheet of stylesheets) {
      await page.addStyleTag({
        path: join(__dirname, '..', '..', '..', 'assets', 'css', stylesheet),
      });
    }
    const pdfBuffer = await page.pdf({ format: 'A4' });

    await browser.close();

    return pdfBuffer;
  }

  // pdf.service.ts

  async generateFromHtml(
    html: string,
    options?: {
      format?: PDFOptions['format'];
      margin?: PDFOptions['margin'];
      printBackground?: boolean;
    }
  ): Promise<Buffer> {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true // Mode headless standard
    });
  
    const page = await browser.newPage();
  
    // Options PDF avec typage correct
    const pdfOptions: PDFOptions = {
      format: options?.format || 'A4',
      margin: options?.margin || {
        top: '20mm',
        right: '10mm',
        bottom: '20mm',
        left: '10mm'
      },
      printBackground: options?.printBackground !== false
    };
  
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf(pdfOptions);
  
    await browser.close();
    return pdfBuffer;
  }


  async getStylesheets(html: string): Promise<string[]> {
    const $ = cheerio.load(html);
    const stylesheets: string[] = [];
    $('link[rel="stylesheet"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (
        href &&
        !href.startsWith('http') &&
        !href.startsWith('https') &&
        !href.startsWith('//')
      ) {
        stylesheets.push(href);
      }
    });
    return stylesheets;
  }

  async imageToBase64(imagePath: string): Promise<string> {
    const imageBuffer = await fs.readFile(imagePath);
    return `data:image/${imagePath.split('.').pop()};base64,${imageBuffer.toString('base64')}`;
  }
}
