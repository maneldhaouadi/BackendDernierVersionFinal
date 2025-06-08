import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ImportArticleDto } from '../dtos/import-article.dto';

interface IPDFPageText { R: Array<{ T: string }>; }
interface IPDFPage { Texts?: IPDFPageText[]; }
interface IPDFData { Pages?: IPDFPage[]; }
interface IPDFParser {
  new (options?: any, version?: number): IPDFParser;
  on(event: string, callback: (...args: any[]) => void): this;
  once(event: string, callback: (...args: any[]) => void): this;
  parseBuffer(buffer: Buffer): void;
  removeAllListeners(event?: string): this;
}

// Suppression des avertissements avant l'import de pdf2json
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  if (args[0]?.includes('TT: undefined function') || args[0]?.includes('Setting up fake worker')) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

const PDFParser: IPDFParser = require('pdf2json');

// Restauration de console.warn après l'import
console.warn = originalConsoleWarn;

@Injectable()
export class PdfArticleExtractorService {
  private readonly logger = new Logger(PdfArticleExtractorService.name);
  private pdfParser: IPDFParser | null = null;

  constructor() { 
    this.initializeParser();
  }

  private initializeParser(): void {
    try {
      this.pdfParser = new PDFParser({
        pagerender: this.renderPage,
        max: 0,
        version: 'v2.0.550',
        worker: false // Désactive l'utilisation des workers
      });

      this.pdfParser.on('pdfParser_dataError', err => {
        this.logger.error('PDF Parse Error', err);
        throw new BadRequestException('Erreur lors de l\'analyse du PDF');
      });

      this.pdfParser.on('error', err => {
        this.logger.error('PDF System Error', err);
        throw new InternalServerErrorException('Erreur système lors du traitement du PDF');
      });
    } catch (error) {
      this.logger.error('Erreur lors de l\'initialisation du parser PDF', error);
      throw new InternalServerErrorException('Erreur lors de l\'initialisation du parser PDF');
    }
  }

  private renderPage(pageData: any): string {
    try {
      return pageData.getTextContent()
        .then((content: any) => {
          const strings = content.items.map((item: any) => item.str);
          return strings.join(' ');
        });
    } catch (error) {
      this.logger.warn('Erreur lors du rendu de la page', error);
      return '';
    }
  }

  async extractStructuredData(pdfBuffer: Buffer, fileName: string): Promise<{
    success: boolean;
    fileName: string;
    totalPages: number;
    pages: Array<{
      id: number;
      name: string;
      contentLength: number;
      preview: string;
      extractedData?: ImportArticleDto;
    }>;
    metadata: {
      extractionDate: Date;
      source: string;
    };
  }> {
    try {
      this.validatePdfBuffer(pdfBuffer);
      const rawText = await this.extractRawText(pdfBuffer);
      
      if (!rawText || rawText.trim().length === 0) {
        throw new BadRequestException('Le PDF ne contient pas de texte extractible');
      }

      const pages = this.splitTextToPages(rawText);
      
      if (pages.length === 0) {
        throw new BadRequestException('Aucune page n\'a pu être extraite du PDF');
      }

      return {
        success: true,
        fileName,
        totalPages: pages.length,
        pages: pages.map((pageContent, index) => {
          const extractedData = this.parseContentToDto(pageContent);
          return {
            id: index + 1,
            name: `${fileName.replace('.pdf', '')}-Page_${index + 1}`,
            contentLength: pageContent.length,
            preview: pageContent.substring(0, 100) + (pageContent.length > 100 ? '...' : ''),
            extractedData
          };
        }),
        metadata: {
          extractionDate: new Date(),
          source: fileName
        }
      };
    } catch (error) {
      this.logger.error('Extraction failed', error.stack);
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new BadRequestException('Erreur lors du traitement du PDF: ' + error.message);
    }
  }

  private async extractRawText(pdfBuffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.pdfParser!.once('pdfParser_dataReady', (pdfData: IPDFData) => {
          try {
            const text = this.processPdfData(pdfData);
            if (!text || text.trim().length === 0) {
              reject(new BadRequestException('Aucun texte n\'a pu être extrait du PDF'));
              return;
            }
            resolve(text);
          } catch (error) {
            reject(new BadRequestException('Erreur lors du traitement des données PDF: ' + error.message));
          }
        });

        this.pdfParser!.parseBuffer(pdfBuffer);
      } catch (error) {
        reject(new BadRequestException('Erreur lors de l\'analyse du PDF: ' + error.message));
      }
    });
  }

  private processPdfData(pdfData: IPDFData): string {
    if (!pdfData.Pages?.length) return '';
    return pdfData.Pages
      .flatMap(page => page.Texts || [])
      .map(text => text.R?.map(r => decodeURIComponent(r.T)).join('') || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private splitTextToPages(fullText: string): string[] {
    // Implémentation basique - à adapter selon votre structure PDF
    return fullText.split(/\f/).filter(page => page.trim().length > 0);
  }

  private parseContentToDto(text: string): ImportArticleDto {
    const extractField = (pattern: RegExp): string | undefined => {
      const match = text.match(pattern);
      return match?.[1]?.trim();
    };

    // Extraction du titre avec pattern amélioré
    const titleMatch = text.match(/(?:Titre|Title)\s*[:.-]?\s*(.*?)(?=\s*(?:R[ée]f[ée]rence|Description|$))/i) ||
                      text.match(/^([^:\n]+?)(?=\s*(?:R[ée]f[ée]rence|Description|$))/i);
    const title = titleMatch?.[1]?.trim();

    // Extraction de la référence avec pattern amélioré
    const refMatch = text.match(/R[ée]f[ée]rence\s*[:.-]?\s*(PROD-\d{4}-\d{3,})/i) ||
                    text.match(/PROD-\d{4}-\d{3,}/i);
    const reference = refMatch?.[1]?.trim() || refMatch?.[0]?.trim();

    // Extraction de la description avec pattern amélioré
    const descMatch = text.match(/Description\s*[:.-]?\s*(.*?)(?=\s*(?:Prix|Quantit[ée]|Notes|$))/is) ||
                     text.match(/(?:Description|Désignation)\s*[:.-]?\s*(.*?)(?=\s*(?:Prix|Quantit[ée]|Notes|$))/is);
    const description = descMatch?.[1]?.trim();

    // Extraction du prix avec pattern amélioré
    const priceMatch = text.match(/(?:Prix|Price|Prix unitaire)\s*[:.-]?\s*(\d+[.,]\d{2})\s*(?:€|EUR|euros?)?/i) ||
                      text.match(/(\d+[.,]\d{2})\s*(?:€|EUR|euros?)/i);
    const price = priceMatch?.[1]?.replace(',', '.');

    // Extraction de la quantité avec pattern amélioré
    const qtyMatch = text.match(/(?:Quantité|Quantity|Quantité disponible)\s*[:.-]?\s*(\d+)(?:\s*(?:unités?|units?|pcs?|pièces?|pieces?))?/i) ||
                    text.match(/(\d+)\s*(?:unités?|units?|pcs?|pièces?|pieces?)/i);
    const quantity = qtyMatch?.[1]?.trim();

    // Extraction des notes avec pattern amélioré
    const notesMatch = text.match(/Notes\s*[:.-]?\s*(.*?)(?=\s*(?:$))/is);
    const notes = notesMatch?.[1]?.trim();

    // Nettoyage des valeurs
    const cleanValue = (value?: string): string | undefined => {
      if (!value) return undefined;
      return value
        .replace(/\s+/g, ' ')
        .replace(/\s*[:.-]\s*$/, '')
        .replace(/^\s*[:.-]\s*/, '')
        .trim();
    };

    return {
      title: cleanValue(title),
      description: cleanValue(description),
      reference: cleanValue(reference),
      quantityInStock: this.parseNumber(quantity),
      unitPrice: this.parseNumber(price),
      notes: cleanValue(notes),
      status: 'draft'
    };
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) return undefined;
    // Supprimer tous les caractères non numériques sauf le point et la virgule
    const cleanValue = value.replace(/[^\d.,]/g, '').replace(',', '.');
    const num = parseFloat(cleanValue);
    return isNaN(num) ? undefined : num;
  }

  private validatePdfBuffer(buffer: Buffer): void {
    if (!buffer || buffer.length < 4 || buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('Invalid PDF file');
    }
  }
}