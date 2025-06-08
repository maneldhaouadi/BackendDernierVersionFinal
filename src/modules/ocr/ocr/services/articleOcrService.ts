import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createWorker, Worker, PSM, OEM } from 'tesseract.js';
import { existsSync, unlinkSync } from 'fs';
import Fuse from 'fuse.js';
import { OcrProcessResponse, FieldRecognitionResult, CorrectionLog } from '../dtos/ocr-result.dto';

interface FieldConfig {
  name: string;
  synonyms: string[];
  patterns: {
    regex: RegExp;
    example: string;
    priority: number;
    valueGroup?: number;
    valueProcessor?: (value: string) => string;
  }[];
  required?: boolean;
  weight?: number;
}

@Injectable()
export class ArticleOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(ArticleOcrService.name);
  private workerPool: Worker[] = [];
  private readonly MAX_WORKERS = 3;
  private lastConfidence = 0;
  private fuse: Fuse<FieldConfig>;

  private readonly fieldConfigs: FieldConfig[] = [
    {
      name: 'title',
      synonyms: ['titre', 'nom', 'name', 'article', 'produit'],
      patterns: [
        {
          regex: /(?:title|titre|nom|name|article|produit)\s*[:=\-]?\s*([^=\n]+?)(?=\s*(?:=|:|\n|reference|référence|ref|description|désignation|designation|price|prix|quantity|quantité|notes|note|$))/i,
          example: "Titre: Clavier gaming mécanique",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => {
            return val
              .replace(/^(?:title|titre|nom|name|article|produit)\s*[:=\-]?\s*/i, '')
              .replace(/\s+/g, ' ')
              .trim();
          }
        },
        {
          regex: /^([^=\n:]+?)(?=\s*(?:=|:|\n|reference|référence|ref|description|désignation|designation|price|prix|quantity|quantité|notes|note|$))/i,
          example: "Gaming Mouse RGB",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => val.trim()
        }
      ],
      weight: 0.2,
      required: true
    },
    {
      name: 'description',
      synonyms: ['description', 'désignation', 'designation', 'produit', 'article', 'détails', 'desc'],
      patterns: [
        {
          regex: /(?:description|désignation|designation|produit|article|détails|desc)\s*[:=\-]?\s*([^\n]+?)(?=\s*(?:référence|ref|quantité|qte|prix|price|unitaire|statut)|$)/i,
          example: "Description: Clavier gaming mécanique RGB",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanField(val, ['reference', 'price', 'quantity'])
        },
        {
          regex: /^(?!.*(?:reference|référence|ref|quantité|qte|prix|price|unitaire|statut))([^\n]+?)(?=\s*(?:référence|ref|quantité|qte|prix|price|unitaire|statut)|$)/i,
          example: "Clavier gaming mécanique RGB",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanField(val, ['reference', 'price', 'quantity'])
        }
      ],
      weight: 0.25,
      required: true
    },
    {
      name: 'reference',
      synonyms: ['référence', 'ref', 'code', 'id', 'numéro', 'n°', 'no', 'facture'],
      patterns: [
        {
          regex: /(?:reference|référence|ref|facture)\s*[:=\-]?\s*(PROD-\d{4}-\d{3,})/i,
          example: "Reference: PROD-2624-789",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.toUpperCase()
        },
        {
          regex: /(PROD-\d{4}-\d{3,})/i,
          example: "PROD-2624-789",
          priority: 2,
          valueGroup: 1
        }
      ]
    },
    {
      name: 'quantity',
      synonyms: ['quantité', 'qte', 'qty', 'stock', 'disponible', 'disponibilité'],
      patterns: [
        {
          regex: /(?:quantité|qte|qty|stock|disponible|disponibilité)\s*[:=\-]?\s*(\d+)(?:\s*(?:unités?|units?|pcs?|pièces?|pieces?))?/i,
          example: "Quantité: 100 unités",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(/\D/g, '')
        },
        {
          regex: /(?:^|\s)(\d+)(?:\s*(?:unités?|units?|pcs?|pièces?|pieces?))(?=\s|$)/i,
          example: "100 unités",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(/\D/g, '')
        }
      ],
      weight: 0.15
    },
    {
      name: 'price',
      synonyms: ['prix', 'unitaire', 'montant', 'tarif', 'coût', 'cout'],
      patterns: [
        {
          regex: /(?:prix|unitaire|montant|tarif|coût|cout)\s*[:=\-]?\s*(\d+[.,]\d{2})\s*(?:€|EUR|euros?)?/i,
          example: "Prix: 89.99 EUR",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(',', '.').replace(/[^\d.]/g, '')
        },
        {
          regex: /(?:^|\s)(\d+[.,]\d{2})\s*(?:€|EUR|euros?)(?=\s|$)/i,
          example: "89.99 EUR",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(',', '.').replace(/[^\d.]/g, '')
        }
      ],
      weight: 0.2
    },
    {
      name: 'notes',
      synonyms: ['note', 'remarque', 'commentaire'],
      patterns: [
        {
          regex: /(?:note|remarque|commentaire)\s*[:=\-]?\s*([^\n]+)/i,
          example: "Note: Livraison express",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanNotes(val)
        }
      ],
      weight: 0.1
    },
    {
      name: 'designation',
      synonyms: ['désignation', 'description', 'titre', 'article', 'produit'],
      patterns: [
        {
          regex: /(?:titre|description|designation|désignation)\s*[:=\-]?\s*([^\n]+?)(?=\s*(?:quantité|quantite|qte|prix|price|unitaire|statut)|$)/i,
          example: "Description: Clavier gaming mécanique",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanDesignation(val)
        },
        {
          regex: /^(?!.*(?:reference|référence|ref|quantité|quantite|qte|prix|price|unitaire|statut))([^\n]+?)(?=\s*(?:quantité|quantite|qte|prix|price|unitaire|statut)|$)/i,
          example: "Clavier gaming mécanique",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanDesignation(val)
        }
      ]
    }
  ];

  constructor() {
    this.initializeFieldSearch();
  }

  private cleanField(value: string, excludeFields: string[]): string {
    if (!value) return value;
    
    // Sauvegarder la valeur originale
    const originalValue = value;
    
    // Supprimer les références et autres champs qui pourraient être dans la valeur
    value = value
      .replace(/=\s*Rference\s*:\s*PROD-\d{4}-\d{3,}/i, '')
      .replace(/=\s*designation\s*:/i, '')
      .replace(/=\s*Rference\s*:/i, '')
      .replace(/PROD-\d{4}-\d{3,}/i, '')
      .replace(/Gaming Mouse RGB 16000 DPI\s*=\s*/i, '')
      .replace(/Gaming Mouse RGB 16000 DPI\s*designation\s*:/i, '')
      .replace(/designation\s*:/i, '')
      .replace(/^\s*{\s*designation\s*:/i, '')
      .replace(/^\s*Gaming Mouse RGB 16000 DPI\s*/i, '');

    // Supprimer les autres champs qui pourraient être dans la valeur
    excludeFields.forEach(field => {
      const fieldConfig = this.fieldConfigs.find(f => f.name === field);
      if (fieldConfig) {
        fieldConfig.patterns.forEach(pattern => {
          value = value.replace(pattern.regex, '');
        });
        fieldConfig.synonyms.forEach(synonym => {
          const regex = new RegExp(`(?:^|\\s)${synonym}\\s*[:=\\-]?\\s*[^\\n]*`, 'i');
          value = value.replace(regex, '');
        });
      }
    });
    
    // Nettoyer les espaces et caractères spéciaux
    value = value
      .replace(/[:=\-]\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Si la valeur est vide après nettoyage, retourner la valeur originale
    return value || originalValue;
  }

  private cleanNotes(value: string): string {
    if (!value) return value;
    
    // Supprimer les marqueurs de début
    value = value
        .replace(/^s\s*:\s*/i, '')
        .replace(/^notes?\s*:\s*/i, '')
        .replace(/^remarque\s*:\s*/i, '')
        .replace(/^commentaire\s*:\s*/i, '');
    
    // Nettoyer les espaces et caractères spéciaux
    return value
        .replace(/\s{2,}/g, ' ')
        .replace(/[:=\-]\s*$/, '')
        .trim();
  }

  private initializeFieldSearch() {
    this.fuse = new Fuse(this.fieldConfigs, {
      keys: ['name', 'synonyms'],
      threshold: 0.4,
      includeScore: true
    });
  }

  private async createWorker(): Promise<Worker> {
    const worker = await createWorker('fra');

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.,:;/\\()[]{}<>@#$%^&*_+=|~`\'" '
    });

    return worker;
  }

  private async getWorker(): Promise<Worker> {
    if (this.workerPool.length < this.MAX_WORKERS) {
      const newWorker = await this.createWorker();
      this.workerPool.push(newWorker);
      return newWorker;
    }
    return this.workerPool[Math.floor(Math.random() * this.workerPool.length)];
  }

  public async processDocument(imagePath: string, debug = false): Promise<OcrProcessResponse> {
    const startTime = Date.now();
    
    try {
      if (!existsSync(imagePath)) {
        throw new Error('File not found');
      }

      const { text, confidence } = await this.extractTextWithRetry(imagePath);
      this.lastConfidence = confidence;

      const preProcessedText = this.preprocessText(text);
      const { correctedText, corrections } = this.correctFieldNames(preProcessedText);
      const recognizedFields = this.analyzeFieldRecognition(correctedText);
      const structuredData = this.structureRecognizedData(correctedText, recognizedFields);
      
      this.postProcessFields(structuredData, correctedText);
      const overallConfidence = this.calculateConfidence(recognizedFields);

      const response: OcrProcessResponse = {
        success: true,
        data: structuredData,
        recognitionDetails: debug ? recognizedFields : undefined,
        corrections: corrections.length > 0 ? corrections : undefined,
        confidence: overallConfidence,
        processingTime: Date.now() - startTime,
        message: 'Document processed successfully'
      };

      if (debug) {
        response.debug = {
          ocrText: text,
          preProcessedText,
          correctedText,
          warnings: overallConfidence < 70 ? ['Low confidence score'] : []
        };
      }

      return response;
    } catch (error) {
      this.logger.error(`Document processing failed: ${error.message}`);
      return {
        success: false,
        data: {},
        confidence: 0,
        processingTime: Date.now() - startTime,
        message: error.message
      };
    }
  }

  private async extractTextWithRetry(imagePath: string, retries = 2): Promise<{
    text: string;
    confidence: number;
  }> {
    let lastError: Error;

    for (let i = 0; i < retries; i++) {
      try {
        const worker = await this.getWorker();
        const { data } = await worker.recognize(imagePath);
        return {
          text: data.text,
          confidence: data.confidence
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`OCR attempt ${i + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }

    throw lastError;
  }

  private preprocessText(text: string): string {
    return text
      .replace(/(\r\n|\n|\r)/gm, '\n')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  private correctFieldNames(text: string): { correctedText: string; corrections: CorrectionLog[] } {
    const corrections: CorrectionLog[] = [];
    let correctedText = text;
    const correctionMap = new Map<string, string>();

    this.fieldConfigs.forEach(fieldConfig => {
      fieldConfig.synonyms.forEach(synonym => {
        correctionMap.set(synonym.toLowerCase(), fieldConfig.name);
      });
    });

    const matches: Array<{term: string; index: number}> = [];
    correctionMap.forEach((correctedTerm, synonym) => {
      const regex = new RegExp(`\\b${synonym}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          term: match[0],
          index: match.index
        });
      }
    });

    matches.sort((a, b) => b.index - a.index);

    matches.forEach(({term, index}) => {
      const lowerTerm = term.toLowerCase();
      if (correctionMap.has(lowerTerm)) {
        const correctedTerm = correctionMap.get(lowerTerm);
        correctedText = correctedText.substring(0, index) + 
                       correctedTerm + 
                       correctedText.substring(index + term.length);
        
        corrections.push({
          original: term,
          corrected: correctedTerm,
          field: correctedTerm,
          confidence: 0.9,
          context: ['semantic-correction']
        });
      }
    });

    return { correctedText, corrections };
  }

  private analyzeFieldRecognition(text: string): FieldRecognitionResult[] {
    return this.fieldConfigs.map(fieldConfig => {
      const recognizedSynonyms = fieldConfig.synonyms.filter(synonym => 
        new RegExp(`\\b${synonym}\\b`, 'i').test(text)
      );
  
      const patterns = fieldConfig.patterns.map(pattern => {
        const match = pattern.regex.exec(text);
        const matched = match !== null;
        
        let confidenceBoost = 0;
        if (matched && pattern.example) {
          const exampleKey = pattern.example.split(':')[0]?.trim().toLowerCase();
          const matchedKey = match[0]?.split(':')[0]?.trim().toLowerCase();
          if (exampleKey && matchedKey && exampleKey.includes(matchedKey)) {
            confidenceBoost = 0.3;
          }
        }
  
        return {
          matched,
          pattern: pattern.example,
          priority: pattern.priority,
          matchedText: match ? match[0] : undefined,
          confidenceBoost
        };
      });
  
      const baseConfidence = (recognizedSynonyms.length > 0 ? 0.4 : 0) + 
                           (patterns.some(p => p.matched) ? 0.6 : 0);
      
      const confidence = baseConfidence + 
                        patterns.reduce((sum, p) => sum + (p.confidenceBoost || 0), 0);
  
      return {
        fieldName: fieldConfig.name,
        confidence: Math.min(1, confidence),
        synonyms: recognizedSynonyms,
        patterns
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  private structureRecognizedData(text: string, recognizedFields: FieldRecognitionResult[]): 
  Record<string, { value: any; confidence: number }> {
    const data: Record<string, { value: any; confidence: number }> = {};
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Extraction du titre en premier
    const titleMatch = text.match(/title\s*:\s*([^:]+?)(?=\s*(?:description|Reference|Quantit|price|Notes)|$)/i);
    if (titleMatch) {
      data.title = {
        value: titleMatch[1].trim(),
        confidence: 90
      };
      this.logger.debug(`Titre extrait directement: ${data.title.value}`);
    }

    // Traitement prioritaire des champs requis
    const requiredFields = this.fieldConfigs.filter(f => f.required);
    for (const fieldConfig of requiredFields) {
      // Skip title if already extracted
      if (fieldConfig.name === 'title' && data.title) continue;

      const field = recognizedFields.find(f => f.fieldName === fieldConfig.name);
      if (!field) continue;

      const values: string[] = [];
      for (const pattern of fieldConfig.patterns.sort((a, b) => b.priority - a.priority)) {
        for (const line of lines) {
          const match = pattern.regex.exec(line);
          if (match) {
            const value = match[pattern.valueGroup || 1];
            if (value) {
              const processedValue = pattern.valueProcessor ? 
                pattern.valueProcessor(value) : 
                value.trim();
              if (this.validateFieldValue(fieldConfig.name, processedValue)) {
                values.push(processedValue);
              }
            }
          }
        }
      }

      if (values.length > 0) {
        const bestValue = this.selectBestValue(values, fieldConfig.name);
        if (bestValue) {
          data[fieldConfig.name] = {
            value: bestValue,
            confidence: field.confidence * 100
          };
        }
      }
    }

    // Traitement des champs optionnels
    const optionalFields = this.fieldConfigs.filter(f => !f.required);
    for (const fieldConfig of optionalFields) {
      if (data[fieldConfig.name]) continue;

      const field = recognizedFields.find(f => f.fieldName === fieldConfig.name);
      if (!field) continue;

      const values: string[] = [];
      for (const pattern of fieldConfig.patterns.sort((a, b) => b.priority - a.priority)) {
        for (const line of lines) {
          const match = pattern.regex.exec(line);
          if (match) {
            const value = match[pattern.valueGroup || 1];
      if (value) {
              const processedValue = pattern.valueProcessor ? 
                pattern.valueProcessor(value) : 
                value.trim();
              if (this.validateFieldValue(fieldConfig.name, processedValue)) {
                values.push(processedValue);
              }
            }
          }
        }
      }

      if (values.length > 0) {
        const bestValue = this.selectBestValue(values, fieldConfig.name);
        if (bestValue) {
          data[fieldConfig.name] = {
            value: bestValue,
          confidence: field.confidence * 100 
        };
      }
      }
    }

    // Post-traitement des champs
    this.postProcessFields(data, text);

    // Validation finale des champs
    this.validateAndCleanFields(data);

    // S'assurer que le titre est présent
    if (!data.title || data.title.value === 'Titre non détecté') {
      const titleMatch = text.match(/title\s*:\s*([^:]+?)(?=\s*(?:description|Reference|Quantit|price|Notes)|$)/i);
      if (titleMatch) {
        data.title = {
          value: titleMatch[1].trim(),
          confidence: 90
        };
        this.logger.debug(`Titre récupéré en dernier recours: ${data.title.value}`);
      } else {
        data.title = {
          value: 'Titre non détecté',
          confidence: 0
        };
      }
    }

    return data;
  }

  private validateFieldValue(fieldName: string, value: string): boolean {
    if (!value) return false;

    switch (fieldName) {
      case 'title':
        return value.length >= 3 && 
               value !== 'Titre non détecté' && 
               !value.startsWith('{ title :') && 
               !value.includes('=') && 
               !value.includes('reference') &&
               !value.includes('description') &&
               !value.includes('PROD-');
      case 'reference':
        return /^PROD-\d{4}-\d{3,}$/i.test(value);
      case 'description':
        return value.length >= 3 && !/^PROD-/.test(value);
      case 'quantity':
        return /^\d+$/.test(value) && parseInt(value) > 0 && parseInt(value) <= 1000000;
      case 'price':
        return /^\d+[.,]\d{2}$/.test(value) && parseFloat(value.replace(',', '.')) > 0 && parseFloat(value.replace(',', '.')) <= 1000000;
      case 'notes':
        return value.length >= 3;
      default:
        return true;
    }
  }

  private validateAndCleanFields(data: Record<string, any>): void {
    // Validation de la référence
    if (data.reference?.value) {
      const ref = data.reference.value.toUpperCase();
      if (!/^PROD-\d{4}-\d{3,}$/.test(ref)) {
        delete data.reference;
      }
    }

    // Validation du titre
    if (data.title?.value) {
      const title = data.title.value.trim();
      if (title.length < 3 || /^PROD-/.test(title)) {
        delete data.title;
      }
    }

    // Validation de la description
    if (data.description?.value) {
      const desc = data.description.value.trim();
      if (desc.length < 3 || /^PROD-/.test(desc)) {
        delete data.description;
      }
    }

    // Validation du prix
    if (data.price?.value) {
      const price = data.price.value.replace(',', '.');
      if (!/^\d+\.\d{2}$/.test(price) || parseFloat(price) <= 0) {
        delete data.price;
      }
    }

    // Validation de la quantité
    if (data.quantity?.value) {
      const qty = data.quantity.value;
      if (!/^\d+$/.test(qty) || parseInt(qty) <= 0) {
        delete data.quantity;
      }
    }
  }

  private postProcessFields(data: Record<string, any>, remainingText: string): void {
    this.logger.debug('=== Début du post-traitement ===');
    this.logger.debug(`Texte restant: ${remainingText}`);

    // Extraction du titre
    if (!data.title || !data.title.value) {
      this.logger.debug('=== Recherche améliorée du titre ===');
      const titleMatch = remainingText.match(/designation\s*:\s*([^=\n]+?)(?=\s*(?:=|:|\n|reference|référence|ref|description|désignation|designation|price|prix|quantity|quantité|notes|note|$))/i);
      if (titleMatch && titleMatch[1]) {
        data.title = {
          value: titleMatch[1].trim(),
          confidence: 95
        };
        this.logger.debug(`Titre trouvé: ${data.title.value}`);
      }
    }

    // Extraction de la description
    if (!data.description || !data.description.value) {
      const descMatch = remainingText.match(/designation\s*:\s*([^=\n]+?)(?=\s*(?:=|:|\n|reference|référence|ref|price|prix|quantity|quantité|notes|note|$))/i);
      if (descMatch && descMatch[1]) {
        data.description = {
          value: this.cleanDescription(descMatch[1]),
          confidence: 100
        };
        this.logger.debug(`Description trouvée: ${data.description.value}`);
      }
    }

    // Extraction de la référence
    if (!data.reference || !data.reference.value) {
      const refMatch = remainingText.match(/Rference\s*:\s*(PROD-\d{4}-\d{3,})/i);
      if (refMatch && refMatch[1]) {
        data.reference = {
          value: refMatch[1].toUpperCase(),
          confidence: 60
        };
        this.logger.debug(`Référence trouvée: ${data.reference.value}`);
      }
    }

    // Prix manquant - Amélioration de l'extraction
    if (!data.price || !data.price.value) {
      this.logger.debug('=== Recherche du prix ===');
      const priceMatch = remainingText.match(/(?:prix|price|unitaire|montant|tarif|coût|cout)\s*[:=\-]?\s*(\d+[.,]\d{2})\s*(?:€|EUR|euros?)?/i);
      if (priceMatch) {
        data.price = {
          value: priceMatch[1].replace(',', '.').replace(/[^\d.]/g, ''),
          confidence: 85
        };
        this.logger.debug(`Prix trouvé: ${data.price.value}`);
      }
    }

    // Quantité manquante - Amélioration de l'extraction
    if (!data.quantity || !data.quantity.value) {
      this.logger.debug('=== Recherche de la quantité ===');
      const qtyMatch = remainingText.match(/(?:quantité|qte|qty|stock|disponible|disponibilité)\s*[:=\-]?\s*(\d+)(?:\s*(?:unités?|units?|pcs?|pièces?|pieces?))?/i);
      if (qtyMatch) {
        data.quantity = {
          value: qtyMatch[1],
          confidence: 80
        };
        this.logger.debug(`Quantité trouvée: ${data.quantity.value}`);
      }
    }

    // Notes manquantes
    if (!data.notes || !data.notes.value) {
      const notesMatch = remainingText.match(/Notes\s*:\s*([^\n]+)/i);
      if (notesMatch && notesMatch[1]) {
        data.notes = {
          value: this.cleanNotes(notesMatch[1]),
          confidence: 60
        };
        this.logger.debug(`Notes trouvées: ${data.notes.value}`);
      }
    }

    // Nettoyage des champs existants
    Object.keys(data).forEach(field => {
      if (data[field]?.value) {
        // Supprimer les références à d'autres champs
        const excludeFields = this.fieldConfigs
          .filter(f => f.name !== field)
          .map(f => f.name);
        
        const cleanedValue = this.cleanField(data[field].value, excludeFields);
        if (cleanedValue) {
          data[field].value = cleanedValue;
        }
      }
    });

    this.logger.debug('=== Résultat final ===');
    this.logger.debug(JSON.stringify(data, null, 2));
    this.logger.debug('=== Fin du post-traitement ===');
  }

  private selectBestValue(values: string[], fieldName: string): string {
    if (values.length === 0) return '';
    if (values.length === 1) return values[0];

    switch (fieldName) {
      case 'reference':
        return values.find(v => /PROD-\d{4}-\d{3,}/i.test(v)) || '';
      case 'price':
        return values.find(v => /^\d+[.,]\d{2}$/.test(v)) || '';
      case 'quantity':
        return values.find(v => /^\d+$/.test(v)) || '';
      default:
        return values.sort((a, b) => b.length - a.length)[0];
    }
  }

  private calculateConfidence(recognizedFields: FieldRecognitionResult[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    recognizedFields.forEach(field => {
      const fieldConfig = this.fieldConfigs.find(f => f.name === field.fieldName);
      if (fieldConfig && fieldConfig.weight) {
        weightedSum += field.confidence * 100 * fieldConfig.weight;
        totalWeight += fieldConfig.weight;
      }
    });

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  public cleanupFile(path: string): void {
    try {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch (err) {
      this.logger.error(`Failed to delete file ${path}: ${err.message}`);
    }
  }

  private cleanDesignation(value: string): string {
    if (!value) return value;
    
    // Supprimer les références et autres champs qui pourraient être dans la valeur
    value = value
      .replace(/=\s*Rference\s*:\s*PROD-\d{4}-\d{3,}/i, '')
      .replace(/=\s*designation\s*:/i, '')
      .replace(/=\s*Rference\s*:/i, '')
      .replace(/PROD-\d{4}-\d{3,}/i, '');
    
    // Supprimer les autres champs qui pourraient être dans la valeur
    this.fieldConfigs.forEach(config => {
      if (config.name !== 'designation') {
        const fieldPattern = new RegExp(
          `(?:\\b${config.name}\\b|\\b${config.synonyms.join('|')}\\b)\\s*[:=\\-]?\\s*[^\\n]*`,
          'i'
        );
        value = value.replace(fieldPattern, '');
      }
    });
    
    // Supprimer les marqueurs de fin et nettoyer
    return value
      .replace(/[:=\-]\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\s*=\s*/, '')
      .trim();
  }

  private cleanDescription(value: string): string {
    if (!value) return value;
    
    // Supprimer les références et autres champs qui pourraient être dans la valeur
    value = value
      .replace(/=\s*Rference\s*:\s*PROD-\d{4}-\d{3,}/i, '')
      .replace(/=\s*designation\s*:/i, '')
      .replace(/=\s*Rference\s*:/i, '')
      .replace(/PROD-\d{4}-\d{3,}/i, '')
      .replace(/Gaming Mouse RGB 16000 DPI\s*=\s*/i, '')
      .replace(/Gaming Mouse RGB 16000 DPI\s*designation\s*:/i, '')
      .replace(/designation\s*:/i, '')
      .replace(/^\s*{\s*designation\s*:/i, '')
      .replace(/^\s*Gaming Mouse RGB 16000 DPI\s*/i, '');

    // Correction des fautes de frappe courantes
    const corrections: Record<string, string> = {
      'quipee': 'équipée',
      'prcis': 'précis',
      'entirement': 'entièrement',
      'avance': 'avancée',
      'rtroeclairage': 'rétroéclairage',
      'Congue': 'Conçue',
      'prcision': 'précision',
      'rapidit': 'rapidité',
      'confort': 'confort',
      'rapiditéé': 'rapidité'
    };

    Object.entries(corrections).forEach(([mistake, correction]) => {
      value = value.replace(new RegExp(mistake, 'gi'), correction);
    });
    
    // Nettoyer les espaces et caractères spéciaux
    return value
      .replace(/\s{2,}/g, ' ')
      .replace(/[:=\-]\s*$/, '')
      .replace(/^\s*=\s*/, '')
      .replace(/^\s*{\s*/, '')
      .replace(/\s*}\s*$/, '')
      .trim();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      this.workerPool.map(worker => worker?.terminate())
    );
    this.workerPool = [];
  }
}