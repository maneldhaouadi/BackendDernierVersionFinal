import { Injectable } from '@nestjs/common';
import * as dialogflow from '@google-cloud/dialogflow';
import * as fs from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { ExpensQuotationEntity } from 'src/modules/expense_quotation/repositories/entities/expensquotation.entity';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';
import { ExpenseInvoiceEntity } from 'src/modules/expense-invoice/repositories/entities/expense-invoice.entity';
import { ArticleExpensQuotationEntryEntity } from 'src/modules/expense_quotation/repositories/entities/article-expensquotation-entry.entity';
import { CurrencyRepository } from 'src/modules/currency/repositories/repository/currency.repository';
import { InterlocutorRepository } from 'src/modules/interlocutor/repositories/repository/interlocutor.repository';
import { ExpenseArticleQuotationEntryRepository } from 'src/modules/expense_quotation/repositories/repository/article-expensquotation-entry.repository';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { FirmRepository } from 'src/modules/firm/repositories/repository/firm.repository';
import { PAYMENT_MODE } from 'src/modules/expense-payment/enums/expense-payment-mode.enum';
import { HistoryRepository } from '../repositories/repository/HistoryRepository';
import { HistoryEntry } from '../interfaces/history_entry.interface';
import { ArticleRepository } from 'src/modules/article/article/repositories/repository/article.repository';


@Injectable()
export class DialogflowService {
  public readonly CREDENTIALS: any;
  public readonly PROJECT_ID: string;
  public sessionClient: dialogflow.SessionsClient;

  constructor(
    @InjectRepository(ExpensQuotationEntity)
    public readonly expensQuotationRepository: Repository<ExpensQuotationEntity>,
    @InjectRepository(ExpenseInvoiceEntity)
    public readonly expenseInvoiceRepository: Repository<ExpenseInvoiceEntity>,
    private readonly currencyRepository: CurrencyRepository,
    private readonly articleRepository: ArticleRepository,
    private readonly interlocutorRepository: InterlocutorRepository,
    private readonly articleEntryRepository: ExpenseArticleQuotationEntryRepository,
    private readonly dataSource: DataSource,
    private readonly firmRepository:FirmRepository,
    private readonly historyRepository: HistoryRepository,

  ) {
    const filePath = 'src/projetadopet-9d2f2-7bd0022ebee4.json';
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      this.CREDENTIALS = JSON.parse(fileContent);
      this.CREDENTIALS.private_key = this.CREDENTIALS.private_key.replace(/\\n/g, '\n');
      this.PROJECT_ID = this.CREDENTIALS.project_id;

      this.sessionClient = new dialogflow.SessionsClient({
        credentials: {
          private_key: this.CREDENTIALS['private_key'],
          client_email: this.CREDENTIALS['client_email'],
        },
      });
    } catch (error) {
      console.error('Error initializing Dialogflow:', error);
      throw error;
    }
  }

  private getTranslation(lang: string) {
    const translations = {
      en: {
        quotation: 'quotation',
        invoice: 'invoice',
        statusResponse: (type: string, num: string, status: string) => 
          `Status of ${type} ${num}: ${status}`,
        notFound: (type: string, num: string) => `${type} ${num} not found`,
        missingNumber: (type: string) => `Please provide a valid ${type} number`,
        error: 'An error occurred. Please try again.',
        fallback: "I didn't understand. Could you rephrase?",
        missingRequiredFields: "Interlocutor ID and articles are required.",
        interlocutorNotFound: "Interlocutor not found.",
        articleNotFound: "Article with ID {{id}} not found.",
        quotationCreated: "Quotation {{object}} created successfully.\n- Reference: {{number}}\n- Total: {{total}} €",
        reminderSent: "Payment reminder sent successfully",
        reportGenerated: "Report generated successfully",
        creationError: "Error creating quotation",
        invalidDocumentType: 'Invalid document type. Please provide an invoice (INV-) or quotation (QUO-).',
        documentNotFound: 'Document {reference} not found.',
        fieldNotFound: 'Field {field} not found in document.',
        comparisonError: 'An error occurred during comparison.',
        invalidQuotationFormat: 'Invalid quotation number format. Please use QUO-XXXXXX format (6 digits).',
      quotationNumberExists: 'Quotation number {number} already exists. Please enter a different number.',
      dueDateBeforeDateError: 'Due date must always be after the creation date.',

      },
      fr: {
        quotation: 'devis',
        invoice: 'facture',
        statusResponse: (type: string, num: string, status: string) => 
          `Statut ${type === 'invoice' ? 'de la facture' : 'du devis'} ${num}: ${status}`,
        notFound: (type: string, num: string) => 
          `${type === 'invoice' ? 'Facture' : 'Devis'} ${num} introuvable`,
        missingNumber: (type: string) => 
          `Veuillez fournir un numéro de ${type === 'invoice' ? 'facture' : 'devis'} valide`,
        error: 'Une erreur est survenue. Veuillez réessayer.',
        fallback: "Je n'ai pas compris. Pouvez-vous reformuler ?",
        missingRequiredFields: "L'ID interlocuteur et les articles sont obligatoires.",
        interlocutorNotFound: "Interlocuteur introuvable.",
        articleNotFound: "Article avec l'ID {{id}} introuvable.",
        quotationCreated: "Devis {{object}} créé avec succès.\n- Référence : {{number}}\n- Total : {{total}} €",
        reminderSent: "Rappel de paiement envoyé avec succès",
        reportGenerated: "Rapport généré avec succès",
        creationError: "Erreur lors de la création du devis",
        invalidDocumentType: 'Type de document invalide. Veuillez fournir une facture (INV-) ou un devis (QUO-).',
        documentNotFound: 'Document {reference} introuvable.',
        fieldNotFound: 'Champ {field} introuvable dans le document.',
        comparisonError: 'Une erreur est survenue lors de la comparaison.',
        invalidQuotationFormat: 'Format de numéro de devis invalide. Veuillez utiliser le format QUO-XXXXXX (6 chiffres).',
        quotationNumberExists: 'Le numéro de devis {number} existe déjà. Veuillez entrer un numéro différent.',
      dueDateBeforeDateError: 'La date d\'échéance doit toujours être postérieure à la date de création.'
      },
      es: {
        quotation: 'presupuesto',
        invoice: 'factura',
        statusResponse: (type: string, num: string, status: string) => 
          `Estado del ${type === 'invoice' ? 'factura' : 'presupuesto'} ${num}: ${status}`,
        notFound: (type: string, num: string) => 
          `No se encontró ${type === 'invoice' ? 'la factura' : 'el presupuesto'} ${num}`,
        missingNumber: (type: string) => 
          `Por favor proporcione un número de ${type === 'invoice' ? 'factura' : 'presupuesto'} válido`,
        error: 'Ocurrió un error. Por favor intente nuevamente.',
        fallback: "No entendí. ¿Podrías repetirlo?",
        missingRequiredFields: "Se requieren ID de interlocutor y artículos.",
        interlocutorNotFound: "Interlocutor no encontrado.",
        articleNotFound: "Artículo con ID {{id}} no encontrado.",
        quotationCreated: "Presupuesto {{object}} creado correctamente.\n- Referencia: {{number}}\n- Total: {{total}} €",
        reminderSent: "Recordatorio de pago enviado correctamente",
        reportGenerated: "Informe generado correctamente",
        creationError: "Error al crear presupuesto",
        invalidDocumentType: 'Tipo de documento inválido. Proporcione una factura (INV-) o presupuesto (QUO-).',
        documentNotFound: 'Documento {reference} no encontrado.',
        fieldNotFound: 'Campo {field} no encontrado en el documento.',
        comparisonError: 'Se produjo un error durante la comparación.',
        invalidQuotationFormat: 'Formato de número de presupuesto inválido. Por favor use el formato QUO-XXXXXX (6 dígitos).',
      quotationNumberExists: 'El número de presupuesto {number} ya existe. Por favor ingrese un número diferente.',
       dueDateBeforeDateError: 'La fecha de vencimiento debe ser siempre posterior a la fecha de creación.'
      }
    };
    
    return translations[lang] || translations['en'];
  }

  
 public async detectIntent(
  languageCode: string,
  queryText: string,
  sessionId: string,
  parameters?: any
): Promise<any> {
  const lang = languageCode || 'fr';
  const t = this.getTranslation(lang);
  const sessionPath = this.sessionClient.projectAgentSessionPath(
    this.PROJECT_ID,
    sessionId
  );

  

  // Phrases exactes pour la création de devis
  const exactQuotationPhrases = [
    'je veux créer une quotation',
    'crée une quotation',
    'nouvelle quotation',
    'créer une quotation',
    'je souhaite créer une quotation'
  ].map(phrase => phrase.toLowerCase().trim().replace(/\s+/g, ' '));

  // Normalisation du texte d'entrée
  const normalizeInput = (text: string) => {
    return text
      .toLowerCase()
      .normalize("NFD") // Séparation des accents
      .replace(/[\u0300-\u036f]/g, "") // Suppression des accents
      .trim()
      .replace(/\s+/g, ' ');
  };

  
  const cleanedInput = normalizeInput(queryText);
  const isQuotationRequest = exactQuotationPhrases.includes(cleanedInput);

  // 1. Gestion des requêtes de création de devis exactes
  if (isQuotationRequest) {
    return {
      fulfillmentText: "Commençons la création de votre devis. Veuillez fournir le numéro séquentiel du devis :",
      outputContexts: [
        {
          name: `${sessionPath}/contexts/awaiting_quotation`,
          lifespanCount: 5,
          parameters: {
            currentStep: "sequentialNumbr",
            quotationData: {
              articles: [],
              status: "draft",
              currencyId: 1
            }
          }
        }
      ]
    };
  }

  // 2. Vérification stricte pour les requêtes contenant "quotation"
  const containsQuotationWord = /\bquotation\b/i.test(queryText);
  if (containsQuotationWord) {
    const isExactMatch = exactQuotationPhrases.some(
      phrase => cleanedInput === phrase
    );

    const hasExtraCharsAfterQuotation = 
      !/\bquotation\b$/i.test(queryText.trim()) && 
      /\bquotation[a-z]*\b/i.test(queryText);

    if (!isExactMatch || hasExtraCharsAfterQuotation) {
      return {
        fulfillmentText: t.fallback,
        intent: 'Default_Fallback_Intent',
        allRequiredParamsPresent: false,
        outputContexts: []
      };
    }
  }

  // 3. Gestion des requêtes d'historique
  const existingHistory = await this.historyRepository.getFullHistory(sessionId);
  const isHistoryRequest = 
    queryText.toLowerCase().includes('history') || 
    queryText.toLowerCase().includes('historique') ||
    queryText.toLowerCase().includes('previous conversations') ||
    queryText.toLowerCase().includes('conversations précédentes');

  if (isHistoryRequest) {
    const history = await this.getHistory(sessionId);
    const response = {
      fulfillmentText: history || t('noHistoryAvailable'),
      intent: 'show_history',
      allRequiredParamsPresent: true,
      outputContexts: parameters?.outputContexts || []
    };
    await this.saveToHistory(sessionId, queryText, response.fulfillmentText);
    return response;
  }

  // 4. Extraction des numéros de documents
  const invoiceNumber = this.extractInvoiceNumber(queryText);
  const quotationNumber = this.extractQuotationNumber(queryText);

  // Validation du format du numéro de devis
  if (quotationNumber) {
  // Ajout d'une vérification de la langue pour la réponse
  if (lang === 'en' && queryText.toLowerCase().includes('status')) {
    const response = await this.handleQuotationStatus(quotationNumber, lang, sessionId);
    await this.saveToHistory(sessionId, queryText, response.fulfillmentText);
    return response;
  }
}

  // 5. Gestion des requêtes de comparaison
  if (this.isComparisonRequest(queryText)) {
    const comparisonParams = {
      data_type: invoiceNumber ? 'facture' : 'devis',
      field_name: this.extractFieldName(queryText),
      user_value: this.extractComparisonValue(queryText),
      reference_id: invoiceNumber || quotationNumber
    };
    
    if (comparisonParams.reference_id) {
      const comparisonResult = await this.handleDataComparison(comparisonParams, lang);
      if (comparisonResult.success) {
        await this.saveToHistory(sessionId, queryText, comparisonResult.message);
        return {
          fulfillmentText: comparisonResult.message,
          intent: 'CompareData',
          allRequiredParamsPresent: true,
          outputContexts: []
        };
      }
    }
  }

  // 6. Gestion des statuts de documents
  if (invoiceNumber) {
    const response = await this.handleInvoiceStatus(invoiceNumber, lang, sessionId);
    await this.saveToHistory(sessionId, queryText, response.fulfillmentText);
    return response;
  }

  if (quotationNumber) {
    const response = await this.handleQuotationStatus(quotationNumber, lang, sessionId);
    await this.saveToHistory(sessionId, queryText, response.fulfillmentText);
    return response;
  }

  // 7. Préparation de la requête Dialogflow standard
  const historyContent = existingHistory.entries.length > 0 
    ? existingHistory.entries
        .map(e => `User: ${e.user}\nBot: ${e.bot}`)
        .join('\n\n')
    : '';

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: queryText,
        languageCode: lang
      }
    },
    queryParams: {
      contexts: parameters?.outputContexts || [],
      payload: {
        fields: {
          conversation_history: {
            stringValue: historyContent
          }
        }
      }
    }
  };

  try {
    const responses = await this.sessionClient.detectIntent(request);
    const result = responses[0].queryResult;

    // Vérification du score de confiance et de l'intention fallback
    if (result.intent?.displayName === 'Default Fallback Intent' || 
        result.intentDetectionConfidence < 0.5) {
      return {
        fulfillmentText: t.fallback,
        intent: 'Default_Fallback_Intent',
        allRequiredParamsPresent: false,
        outputContexts: []
      };
    }

    if (result.intent?.displayName === 'FAQ_Quotation' && 
    result.parameters.fields['quotation_number']) {
  // Use Dialogflow's extracted parameter
  const quotationNumber = result.parameters.fields['quotation_number'].stringValue;
  return this.handleQuotationStatus(quotationNumber, lang, sessionId);
}
// Après la partie FAQ_Quotation, ajoutez ce bloc pour les factures
if (result.intent?.displayName === 'FAQ_Invoice' && 
    result.parameters.fields['invoice_number']) {
  // Utiliser le paramètre extrait par Dialogflow
  const invoiceNumber = result.parameters.fields['invoice_number'].stringValue;
  return this.handleInvoiceStatus(invoiceNumber, lang, sessionId);
}

// Sinon procéder à l'extraction personnalisée
const customInvoiceNumber = this.extractInvoiceNumber(queryText);
if (customInvoiceNumber) {
  return this.handleInvoiceStatus(customInvoiceNumber, lang, sessionId);
}

// Otherwise proceed with your custom extraction
const customQuotationNumber = this.extractQuotationNumber(queryText);
if (customQuotationNumber) {
  return this.handleQuotationStatus(customQuotationNumber, lang, sessionId);
}


    // Gestion des intents spécifiques
    switch (result.intent?.displayName) {
      case 'AddQuotationArticle':
        if (result.allRequiredParamsPresent) {
          const params = result.parameters.fields;
          const discountType = params.discountType?.stringValue?.toUpperCase() === 'AMMOUNT' 
            ? DISCOUNT_TYPES.AMOUNT 
            : DISCOUNT_TYPES.PERCENTAGE;

          const addResult = await this.addArticleToQuotation({
            quotationNumber: params.quotationNumber?.stringValue,
            articleId: params.articleId.numberValue,
            quantity: params.quantity.numberValue,
            discount: params.discount?.numberValue || 0,
            discount_type: discountType,
            unit_price: params.unitPrice?.numberValue
          }, lang);

          await this.saveToHistory(sessionId, queryText, addResult.message);
          return {
            fulfillmentText: addResult.message,
            intent: result.intent.displayName,
            parameters: result.parameters,
            outputContexts: result.outputContexts,
            allRequiredParamsPresent: true
          };
        }
        break;

      case 'CreateQuotation':
        if (result.allRequiredParamsPresent) {
          try {
            const params = result.parameters.fields;
            const articles = [];
            const articleId = params.articleId?.numberValue;

            if (articleId !== undefined) {
              const articleInfo = await this.getArticleInfo(articleId, lang);
              if (!articleInfo) {
                throw new Error(t.articleNotFound.replace('{{id}}', articleId.toString()));
              }

              articles.push({
                articleId: articleId,
                quantity: params.quantity?.numberValue || 1,
                discount: params.discount?.numberValue || 0,
                discount_type: params.discount_type?.stringValue as DISCOUNT_TYPES || DISCOUNT_TYPES.PERCENTAGE,
                unit_price: articleInfo.unitPrice
              });
            }

            const creationResult = await this.createQuotation({
              firmName: params.firmName.stringValue,
              cabinetId: params.cabinetId?.numberValue || 1,
              interlocutorName: params.interlocutorName.stringValue,
              currencyId: params.currencyId?.numberValue,
              object: params.object?.stringValue || `${t.quotation} ${new Date().toLocaleDateString(lang)}`,
              sequentialNumbr: params.sequentialNumbr?.stringValue,
              articles: articles,
              status: this.mapStatusStringToEnum(params.status?.stringValue),
              dueDate: params.duedate?.stringValue ? new Date(params.duedate.stringValue) : undefined,
              date: params.date?.stringValue ? new Date(params.date.stringValue) : new Date()
            }, lang, sessionId, queryText);

            await this.saveToHistory(sessionId, queryText, creationResult.message);
            return {
              fulfillmentText: creationResult.message,
              intent: result.intent.displayName,
              parameters: result.parameters,
              outputContexts: result.outputContexts,
              allRequiredParamsPresent: true
            };
          } catch (error) {
            console.error('Error in CreateQuotation intent:', error);
            await this.saveToHistory(sessionId, queryText, `${t.creationError}: ${error.message}`);
            return {
              fulfillmentText: `${t.creationError}: ${error.message}`,
              outputContexts: []
            };
          }
        }
        break;
    }

    // Réponse par défaut pour les autres intentions
    await this.saveToHistory(sessionId, queryText, result.fulfillmentText);
    return {
      fulfillmentText: result.fulfillmentText,
      intent: result.intent?.displayName,
      parameters: result.parameters,
      outputContexts: result.outputContexts,
      allRequiredParamsPresent: result.allRequiredParamsPresent
    };

  } catch (error) {
    console.error('Dialogflow error:', error);
    await this.saveToHistory(sessionId, queryText, t.error);
    return {
      fulfillmentText: t.error,
      outputContexts: []
    };
  }
}
  private extractComparisonValue(text: string): string | number | null {
  // Détection spécifique des montants avec le symbole €
  const euroAmountMatch = text.match(/(\d+[\.,]?\d*)\s*€/i);
  if (euroAmountMatch) return parseFloat(euroAmountMatch[1].replace(',', '.'));

  // Détection des valeurs entre guillemets (pour le statut)
  const quotedMatch = text.match(/['"]([^'"]+)['"]/);
  if (quotedMatch) return quotedMatch[1].toLowerCase();
  
  // Détection des valeurs booléennes
  if (text.includes('payé') || text.includes('paid')) return 'paid';
  if (text.includes('non payé') || text.includes('unpaid')) return 'unpaid';
  
  // Détection générique des nombres (fallback)
  const genericNumberMatch = text.match(/(\d+[\.,]?\d*)/);
  return genericNumberMatch ? parseFloat(genericNumberMatch[0].replace(',', '.')) : null;
}
  // Méthodes utilitaires ajoutées
  private extractDataType(text: string): string {
    return text.includes('devis') ? 'devis' : 
           text.includes('facture') ? 'facture' : 'document';
  }
  
  private extractFieldName(text: string): string {
    if (text.includes('montant') || text.includes('total')) return 'total';
    if (text.includes('statut')) return 'status';
    return 'total';
  }
  
  private isComparisonRequest(text: string): boolean {
    const comparisonKeywords = [
      'compar', 'vérif', 'vérifie', 'confirme', 'identique', 
      'match', 'correspond', 'est-ce que', 'a-t-il', 'a-t-elle'
    ];
    
    return comparisonKeywords.some(keyword => 
      text.toLowerCase().includes(keyword)
    ) || /est\s*(?:il|elle)\s*(?:égal|identique)/i.test(text);
  }
  
  private extractReferenceId(text: string): string | null {
    const match = text.match(/(QUO|INV|DEV)-\d{4}-\d{2}-\d+/i);
    return match ? match[0].toUpperCase() : null;
  }
  
  private formatPaymentResponse(payments: any, lang: string): string {
    let response = lang === 'en' 
      ? `Payments for invoice ${payments.invoiceNumber}:\n`
      : `Paiements pour la facture ${payments.invoiceNumber}:\n`;
    
    payments.payments.forEach(p => {
      response += `- ${p.amount} ${payments.currency} (${p.mode}) ${lang === 'en' ? 'on' : 'le'} ${new Date(p.date).toLocaleDateString(lang)}\n`;
    });
    
    response += lang === 'en'
      ? `\nTotal: ${payments.total} ${payments.currency}\n`
      : `\nTotal : ${payments.total} ${payments.currency}\n`;
    response += lang === 'en'
      ? `Paid: ${payments.paidAmount} ${payments.currency}\n`
      : `Payé : ${payments.paidAmount} ${payments.currency}\n`;
    response += lang === 'en'
      ? `Remaining: ${payments.remainingAmount} ${payments.currency}`
      : `Restant : ${payments.remainingAmount} ${payments.currency}`;
  
    return response;
  }

public async getFirmByName(name: string) {
  return this.firmRepository.findOne({
      where: { name },
      relations: ['interlocutorsToFirm', 'interlocutorsToFirm.interlocutor']
  });
}
private async addArticleToQuotation(
  params: {
    quotationNumber?: string;
    articleId: number;
    quantity: number;
    discount?: number;
    discount_type?: DISCOUNT_TYPES;
    unit_price?: number;
    reference?: string; // Ajout du paramètre optionnel pour la référence
  },
  lang: string = 'fr'
): Promise<{ success: boolean; message: string; articleId?: number }> {
  const t = this.getTranslation(lang);
  const queryRunner = this.dataSource.createQueryRunner();
  
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // 1. Vérification/création de l'article
    let article = await this.articleRepository.findOne({ 
      where: { id: params.articleId },
      select: ['id', 'title', 'unitPrice', 'quantityInStock', 'status', 'version', 'reference']
    });

    if (!article) {
      article = this.articleRepository.create({
        id: params.articleId,
        title: `Article ${params.articleId}`,
        description: 'Créé automatiquement',
        unitPrice: params.unit_price || 100,
        quantityInStock: 0,
        status: 'active',
        version: 1,
        reference: `REF-${params.articleId.toString().padStart(6, '0')}`
      });
      article = await this.articleRepository.save(article);
    }

    // Calcul des montants
    const unitPrice = params.unit_price || article.unitPrice;
    const discount = params.discount || 0;
    const discountType = params.discount_type || DISCOUNT_TYPES.PERCENTAGE;
    
    const subTotal = unitPrice * params.quantity;
    const discountAmount = discountType === DISCOUNT_TYPES.AMOUNT 
      ? discount 
      : subTotal * (discount / 100);
    const total = subTotal - discountAmount;

    // 2. Création de l'entrée avec référence
    const articleEntry = this.articleEntryRepository.create({
      article: article,
      quantity: params.quantity,
      unit_price: unitPrice,
      discount: discount,
      discount_type: discountType,
      subTotal: subTotal,
      total: total,
      reference: params.reference || this.generateReference(), // Utilise la référence fournie ou en génère une
    });

    // 3. Lien avec le devis si nécessaire
    if (params.quotationNumber) {
      const quotation = await this.expensQuotationRepository.findOne({
        where: { sequentialNumbr: params.quotationNumber },
        select: ['id', 'subTotal', 'total']
      });
      
      if (quotation) {
        articleEntry.expenseQuotation = quotation;
        await this.expensQuotationRepository.update(quotation.id, {
          subTotal: quotation.subTotal + articleEntry.subTotal,
          total: quotation.total + articleEntry.total
        });
      }
    }

    // 4. Sauvegarde finale
    await this.articleEntryRepository.save(articleEntry);
    await queryRunner.commitTransaction();

    // Vérification
    const exists = await this.articleEntryRepository.findOne({
      where: { id: articleEntry.id },
      relations: ['article', 'expenseQuotation']
    });

    if (!exists) {
      throw new Error("La création a échoué silencieusement");
    }

    return {
      success: true,
      message: lang === 'fr'
        ? `Article "${article.title}" (ID:${article.id}) ajouté avec succès. Référence: ${articleEntry.reference}`
        : `Article "${article.title}" (ID:${article.id}) added successfully. Reference: ${articleEntry.reference}`,
      articleId: article.id
    };

  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error('Erreur complète:', {
      params,
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      message: `${lang === 'fr' ? "Erreur technique" : "Technical error"}: ${error.message}`
    };
  } finally {
    await queryRunner.release();
  }
}

// Méthode pour générer la référence au format REF-193286-873
private generateReference(): string {
  const part1 = Math.floor(100000 + Math.random() * 900000); // 6 chiffres aléatoires
  const part2 = Math.floor(100 + Math.random() * 900);       // 3 chiffres aléatoires
  return `REF-${part1}-${part2}`;
}

private mapStatusStringToEnum(statusString?: string): EXPENSQUOTATION_STATUS {
  if (!statusString) return EXPENSQUOTATION_STATUS.Draft;
  
  const statusMap = {
    'expense_quotation.status.draft': EXPENSQUOTATION_STATUS.Draft,
    'expense_quotation.status.expired': EXPENSQUOTATION_STATUS.Expired
  };

  return statusMap[statusString] || EXPENSQUOTATION_STATUS.Draft;
}

public async getArticleInfo(articleId: number, lang: string = 'fr') {
  try {
    return await this.articleRepository.findOne({
      where: { id: articleId },
      select: ['id', 'title'] // Sélectionnez les champs nécessaires
    });
  } catch (error) {
    return null;
  }
}
private async handleQuotationStatus(
  quotationNumber: string,
  lang: string,
  sessionId: string
): Promise<any> {
  const t = this.getTranslation(lang);
  
  try {
    const quotationStatus = await this.getQuotationStatus(quotationNumber);
    
    if (!quotationStatus) {
      return {
        fulfillmentText: t.notFound(t.quotation, quotationNumber),
        intent: 'FAQ_Quotation',
        allRequiredParamsPresent: true,
        outputContexts: []
      };
    }

    const statusMessage = this.getQuotationStatusMessage(quotationStatus.status, lang);
    const amount = this.formatCurrency(quotationStatus.details?.amount || 0, lang);
    const date = this.formatDate(quotationStatus.details?.date?.toISOString(), lang);

    let fulfillmentText;
    if (lang === 'fr') {
      fulfillmentText = `Statut du devis ${quotationNumber}: ${statusMessage}\nMontant total: ${amount}\nDate de création: ${date}`;
    } else if (lang === 'es') {
      fulfillmentText = `Estado del presupuesto ${quotationNumber}: ${statusMessage}\nMonto total: ${amount}\nFecha de creación: ${date}`;
    } else {
      fulfillmentText = `Status of quotation ${quotationNumber}: ${statusMessage}\nTotal amount: ${amount}\nCreation date: ${date}`;
    }

    return {
      fulfillmentText,
      intent: 'FAQ_Quotation',
      allRequiredParamsPresent: true,
      outputContexts: [{
        name: `projects/${this.PROJECT_ID}/agent/sessions/${sessionId}/contexts/quotation-status`,
        lifespanCount: 5,
        parameters: {
          quotationNumber,
          status: quotationStatus.status,
          amount: quotationStatus.details?.amount,
          date: quotationStatus.details?.date
        }
      }]
    };
  } catch (error) {
    console.error('Error handling quotation status:', error);
    return {
      fulfillmentText: t.error,
      intent: 'FAQ_Quotation',
      allRequiredParamsPresent: false,
      outputContexts: []
    };
  }
}
  
private extractQuotationNumber(text: string): string | null {
  // More flexible pattern that matches QUO- followed by digits
  const pattern = /(?:quotation|devis|presupuesto|quote|purchase\s+quotation)\s*(?:no|num|number)?\s*[:#]?\s*(QUO-\d+)|(QUO-\d+)/i;
  const match = text.match(pattern);
  return match ? (match[1] || match[2]).toUpperCase() : null;
}
private isValidQuotationFormat(quotationNumber: string): boolean {
  // Vérifie que le numéro commence par QUO- suivi de exactement 6 chiffres
  return /^QUO-\d{6}$/i.test(quotationNumber);
}
 

  private extractInvoiceNumber(text: string): string | null {
  // Patterns plus complets pour détecter les numéros de facture
  const patterns = [
    /(?:invoice|facture|factura)\s+(?:no|num|number)?\s*[:#]?\s*(INV-\d+)/i,
    /(?:status|statut|estado)\s+(?:of|pour|de)?\s*(?:invoice|facture|factura)?\s*(?:no|num|number)?\s*[:#]?\s*(INV-\d+)/i,
    /^(INV-\d+)$/i,
    /(INV-\d+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

  private async handleInvoiceStatus(
  invoiceNumber: string,
  lang: string,
  sessionId: string
): Promise<any> {
  const t = this.getTranslation(lang);
  
  try {
    // Validation du numéro de facture
    if (!invoiceNumber || !invoiceNumber.startsWith('INV-')) {
      return {
        fulfillmentText: t.missingNumber(t.invoice),
        outputContexts: []
      };
    }

    const invoiceStatus = await this.getInvoiceStatus(invoiceNumber);
    
    if (!invoiceStatus) {
      return {
        fulfillmentText: t.notFound(t.invoice, invoiceNumber),
        intent: 'FAQ_Invoice',
        allRequiredParamsPresent: true,
        outputContexts: []
      };
    }

    const statusMessage = this.getInvoiceStatusMessage(invoiceStatus.status, lang);
    const amount = this.formatCurrency(invoiceStatus.details?.amount || 0, lang);
    const paidAmount = this.formatCurrency(invoiceStatus.details?.paidAmount || 0, lang);
    const dueDate = this.formatDate(invoiceStatus.details?.dueDate, lang);

    let fulfillmentText;
    switch(lang) {
      case 'fr':
        fulfillmentText = `Statut de la facture ${invoiceNumber}: ${statusMessage}\nMontant: ${amount}\nMontant payé: ${paidAmount}\nDate d'échéance: ${dueDate}`;
        break;
      case 'es':
        fulfillmentText = `Estado de la factura ${invoiceNumber}: ${statusMessage}\nMonto: ${amount}\nMonto pagado: ${paidAmount}\nFecha de vencimiento: ${dueDate}`;
        break;
      default:
        fulfillmentText = `Status of invoice ${invoiceNumber}: ${statusMessage}\nAmount: ${amount}\nPaid amount: ${paidAmount}\nDue date: ${dueDate}`;
    }

    return {
      fulfillmentText,
      intent: 'FAQ_Invoice',
      allRequiredParamsPresent: true,
      outputContexts: [{
        name: `projects/${this.PROJECT_ID}/agent/sessions/${sessionId}/contexts/invoice-status`,
        lifespanCount: 5,
        parameters: {
          invoiceNumber,
          status: invoiceStatus.status,
          amount: invoiceStatus.details?.amount,
          paidAmount: invoiceStatus.details?.paidAmount,
          dueDate: invoiceStatus.details?.dueDate
        }
      }]
    };
  } catch (error) {
    console.error('Error handling invoice status:', error);
    return {
      fulfillmentText: t.error,
      intent: 'FAQ_Invoice',
      allRequiredParamsPresent: false,
      outputContexts: []
    };
  }
}

  public async getQuotationStatus(sequentialNumber: string): Promise<{ 
    quotationNumber: string, 
    status: EXPENSQUOTATION_STATUS,
    details?: {
      amount?: number;
      date?: Date;
      articleCount?: number;
    }
  } | null> {

    if (!this.isValidQuotationFormat(sequentialNumber)) {
      throw new Error(this.getTranslation('en').invalidQuotationFormat);
    }
    
    try {
        const quotation = await this.expensQuotationRepository
            .createQueryBuilder('quotation')
            .leftJoinAndSelect('quotation.expensearticleQuotationEntries', 'articles')
            .where('quotation.sequentialNumbr = :number', { number: sequentialNumber })
            .getOne();

        if (!quotation) {
            return null;
        }

        return {
            quotationNumber: quotation.sequentialNumbr,
            status: quotation.status,
            details: {
                amount: quotation.total,
                date: quotation.date,
                articleCount: quotation.expensearticleQuotationEntries?.length || 0
            }
        };
    } catch (error) {
        console.error('Database error (quotation):', error);
        throw new Error(this.getTranslation('en').error);
    }
  }

  public getQuotationStatusMessage(status: EXPENSQUOTATION_STATUS, lang: string = 'en'): string {
    const translations = {
        en: {
            [EXPENSQUOTATION_STATUS.Expired]: 'Expired',
            [EXPENSQUOTATION_STATUS.Draft]: 'Draft',
            unknown: 'Unknown Status'
        },
        fr: {
            [EXPENSQUOTATION_STATUS.Expired]: 'Expiré',
            [EXPENSQUOTATION_STATUS.Draft]: 'Brouillon',
            unknown: 'Statut inconnu'
        },
        es: {
            [EXPENSQUOTATION_STATUS.Expired]: 'Expirado',
            [EXPENSQUOTATION_STATUS.Draft]: 'Borrador',
            unknown: 'Estado desconocido'
        }
    };
    
    const langMap = translations[lang] || translations.en;
    return langMap[status] || langMap.unknown;
  }

  public async getInvoiceStatus(invoiceNumber: string): Promise<{ 
    invoiceNumber: string, 
    status: EXPENSE_INVOICE_STATUS,
    details?: {
      amount?: number;
      dueDate?: string;
      paidAmount?: number;
    }
  } | null> {
    try {
      const invoice = await this.expenseInvoiceRepository.findOne({
        where: { sequentialNumbr: invoiceNumber },
        relations: ['payments']
      });

      if (!invoice) return null;

      return {
        invoiceNumber: invoice.sequentialNumbr,
        status: invoice.status,
        details: {
          amount: invoice.total,
          dueDate: invoice.dueDate?.toISOString(),
          paidAmount: invoice.payments?.reduce((sum, payment) => sum + payment.amount, 0)
        }
      };
    } catch (error) {
      console.error('Database error (invoice):', error);
      throw error;
    }
  }

  public getInvoiceStatusMessage(status: EXPENSE_INVOICE_STATUS, lang: string = 'en'): string {
    const statusMap = {
      en: {
        [EXPENSE_INVOICE_STATUS.Draft]: 'Draft',
        [EXPENSE_INVOICE_STATUS.Validated]: 'Validated',
        [EXPENSE_INVOICE_STATUS.Paid]: 'Paid',
        [EXPENSE_INVOICE_STATUS.PartiallyPaid]: 'Partially Paid',
        [EXPENSE_INVOICE_STATUS.Unpaid]: 'Unpaid',
        [EXPENSE_INVOICE_STATUS.Expired]: 'Expired',
      },
      fr: {
        [EXPENSE_INVOICE_STATUS.Draft]: 'Brouillon',
        [EXPENSE_INVOICE_STATUS.Validated]: 'Validé',
        [EXPENSE_INVOICE_STATUS.Paid]: 'Payé',
        [EXPENSE_INVOICE_STATUS.PartiallyPaid]: 'Partiellement payé',
        [EXPENSE_INVOICE_STATUS.Unpaid]: 'Impayé',
        [EXPENSE_INVOICE_STATUS.Expired]: 'Expiré',
      },
      es: {
        [EXPENSE_INVOICE_STATUS.Draft]: 'Borrador',
        [EXPENSE_INVOICE_STATUS.Validated]: 'Validado',
        [EXPENSE_INVOICE_STATUS.Paid]: 'Pagado',
        [EXPENSE_INVOICE_STATUS.PartiallyPaid]: 'Parcialmente pagado',
        [EXPENSE_INVOICE_STATUS.Unpaid]: 'No pagado',
        [EXPENSE_INVOICE_STATUS.Expired]: 'Expirado',
      }
    };
    
    return statusMap[lang]?.[status] || statusMap['en'][status] || 'Unknown Status';
  }

  private formatCurrency(amount?: number, lang: string = 'es'): string {
    if (amount === undefined) return 'N/A';
    return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }

  private formatDate(dateString?: string, lang: string = 'es'): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  public async createQuotation(
    params: {
      firmName: string;
      cabinetId?: number;
      interlocutorName: string;
      currencyId?: number;
      object?: string;
      sequentialNumbr?: string;
      articles: Array<{
        articleId: number;
        quantity: number;
        unit_price?: number;
        discount?: number;
        discount_type?: DISCOUNT_TYPES;
      }>;
      bankAccountId?: number;
      pdfFileId?: number;
      generalConditions?: string;
      status?: EXPENSQUOTATION_STATUS;
      dueDate?: Date | string;       
      notes?: string;
      date?: Date | string;
      discount?: number;
      discount_type?: DISCOUNT_TYPES;
      taxStamp?: number;
      expenseMetaDataId?: number;
      isDeletionRestricted?: boolean;
    },
    lang: string = 'fr',
    sessionId?: string,
    userQuery?: string
  ) {
    const t = this.getTranslation(lang);
    const queryRunner = this.dataSource.createQueryRunner();
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
  
    try {
      if (params.sequentialNumbr) {
        const existingQuotation = await this.expensQuotationRepository.findOne({
          where: { sequentialNumbr: params.sequentialNumbr }
        });
        
        if (existingQuotation) {
          const errorMessage = t.quotationNumberExists.replace('{number}', params.sequentialNumbr);
          if (sessionId) {
            await this.saveToHistory(sessionId, userQuery || 'Create quotation request', errorMessage);
          }
          throw new Error(errorMessage);
        }
      }
  
      // Validation des champs obligatoires
      if (!params.interlocutorName || !params.articles || params.articles.length === 0) {
        throw new Error(t.missingRequiredFields);
      }
  
      // Récupération de la firme par nom
      const firm = await this.firmRepository.findOne({
        where: { name: params.firmName },
        relations: ['interlocutorsToFirm', 'interlocutorsToFirm.interlocutor']
      });
      
      if (!firm) {
        throw new Error(`Firm with name ${params.firmName} not found`);
      }
  
      // Recherche de l'interlocuteur par nom dans la firme
      const normalizedInput = params.interlocutorName.toLowerCase().trim();
      const interlocutorEntry = firm.interlocutorsToFirm.find(entry => {
        const fullName = `${entry.interlocutor.name} ${entry.interlocutor.surname}`.toLowerCase().trim();
        return fullName === normalizedInput;
      });
  
      if (!interlocutorEntry) {
        throw new Error(`Interlocutor ${params.interlocutorName} not found in firm ${params.firmName}`);
      }
  
      const interlocutor = interlocutorEntry.interlocutor;
  
      // Traitement des articles
      const articleEntries: ArticleExpensQuotationEntryEntity[] = [];
      let subTotal = 0;
  
      for (const item of params.articles) {
        const article = await this.articleRepository.findOne({
          where: { id: item.articleId }
        });
        
        if (!article) {
          throw new Error(t.articleNotFound.replace('{{id}}', item.articleId.toString()));
        }
  
        const unitPrice = item.unit_price;
        const discountAmount = item.discount 
          ? (item.discount_type === DISCOUNT_TYPES.AMOUNT 
              ? item.discount 
              : (unitPrice * item.quantity * item.discount / 100))
          : 0;
  
        const articleSubTotal = unitPrice * item.quantity;
        const articleTotal = articleSubTotal - discountAmount;
  
        const articleEntry = new ArticleExpensQuotationEntryEntity();
        articleEntry.article = article;
        articleEntry.quantity = item.quantity;
        articleEntry.unit_price = unitPrice;
        articleEntry.discount = item.discount || 0;
        articleEntry.discount_type = item.discount_type || DISCOUNT_TYPES.PERCENTAGE;
        articleEntry.subTotal = articleSubTotal;
        articleEntry.total = articleTotal;
  
        articleEntries.push(articleEntry);
        subTotal += articleTotal;
      }
  
      // Calcul du total
      let total = subTotal;
  
      if (params.discount) {
        total = params.discount_type === DISCOUNT_TYPES.AMOUNT
          ? total - params.discount
          : total * (1 - (params.discount / 100));
      }
  
      if (params.taxStamp) {
        total += params.taxStamp;
      }
  
      // Génération du numéro séquentiel si non fourni
      const sequentialNumbr = params.sequentialNumbr 
        ?? `QUO-${new Date().getFullYear()}-${(await this.getNextQuotationNumber()).toString().padStart(4, '0')}`;
  
      // Création du devis
      const quotation = new ExpensQuotationEntity();
      quotation.firmId = firm.id;
      quotation.cabinetId = params.cabinetId ?? firm.cabinetId ?? 1;
      quotation.interlocutor = interlocutor;
      quotation.currencyId = params.currencyId ?? firm.currencyId ?? 1;
      quotation.object = params.object ?? `Devis ${new Date().toLocaleDateString()}`;
      quotation.status = params.status ?? EXPENSQUOTATION_STATUS.Draft;
      quotation.generalConditions = params.generalConditions ?? '';
      quotation.bankAccountId = params.bankAccountId ?? null;
      quotation.pdfFileId = params.pdfFileId ?? null;
      quotation.sequentialNumbr = sequentialNumbr;
      quotation.sequential = sequentialNumbr;
      const parsedDate = typeof params.date === 'string' ? new Date(params.date) : params.date;
      const parsedDueDate = typeof params.dueDate === 'string' ? new Date(params.dueDate) : params.dueDate;
      
      // Validation de la dueDate
      if (parsedDueDate && parsedDate && parsedDueDate < parsedDate) {
        throw new Error(t.dueDateBeforeDateError);
      }
  
      // Utilisation des dates converties
      quotation.date = parsedDate ?? new Date();
      quotation.dueDate = parsedDueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      quotation.total = total;
      quotation.notes = params.notes ?? '';
      quotation.discount = params.discount ?? 0;
      quotation.discount_type = params.discount_type ?? DISCOUNT_TYPES.PERCENTAGE;
      quotation.taxStamp = params.taxStamp ?? 0;
      quotation.expenseMetaDataId = params.expenseMetaDataId ?? null;
      quotation.isDeletionRestricted = params.isDeletionRestricted ?? false;
  
      // Sauvegarde transactionnelle
      const savedQuotation = await queryRunner.manager.save(quotation);
      
      // Sauvegarde des articles
      for (const entry of articleEntries) {
        entry.expenseQuotation = savedQuotation;
        await queryRunner.manager.save(entry);
      }
      if (params.sequentialNumbr && !this.isValidQuotationFormat(params.sequentialNumbr)) {
        const errorMessage = t('invalidQuotationFormat');
        if (sessionId) {
          await this.saveToHistory(sessionId, userQuery || 'Create quotation request', errorMessage);
        }
        throw new Error(errorMessage);
      }
  
      await queryRunner.commitTransaction();
  
      const successMessage = t.quotationCreated
        .replace('{{object}}', savedQuotation.object)
        .replace('{{number}}', savedQuotation.sequentialNumbr)
        .replace('{{total}}', savedQuotation.total.toFixed(2));
  
      // Sauvegarder dans l'historique
      if (sessionId) {
        await this.saveToHistory(sessionId, userQuery || 'Create quotation request', successMessage);
      }
  
      return {
        success: true,
        quotationNumber: savedQuotation.sequentialNumbr,
        total: savedQuotation.total,
        message: successMessage,
        details: {
          quotationId: savedQuotation.id,
          date: savedQuotation.date,
          dueDate: savedQuotation.dueDate,
          articleCount: articleEntries.length,
          cabinetId: savedQuotation.cabinetId
        }
      };
  
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage = `${t.creationError}: ${error.message}`;
      if (sessionId) {
        await this.saveToHistory(sessionId, userQuery || 'Create quotation request', errorMessage);
      }
      throw new Error(errorMessage);
    } finally {
      await queryRunner.release();
    }
  }
  
  private async getNextQuotationNumber(): Promise<number> {
    const lastQuote = await this.expensQuotationRepository
      .createQueryBuilder('quotation')
      .where('quotation.sequentialNumbr LIKE :pattern', { pattern: 'QUO-%' })
      .orderBy('quotation.createdAt', 'DESC')
      .getOne();
  
    if (!lastQuote || !lastQuote.sequentialNumbr) {
      return 1;
    }
  
    const matches = lastQuote.sequentialNumbr.match(/QUO-(\d{4})-(\d+)/);
    
    if (matches && matches[2]) {
      return parseInt(matches[2], 10) + 1;
    }
    
    return 1;
  }
  // Dans DialogflowService
// Dans DialogflowService
public async getPredictedLatePayments(
  firmId: number,
  minAmount: number = 100,
  currency: string = 'EUR',
  daysAhead: number = 30,
  sessionId?: string, // Ajout du paramètre sessionId
  userQuery?: string   // Ajout du paramètre userQuery (la question originale)
) {
  try {
    // 1. Vérifier la devise
    const currencyEntity = await this.currencyRepository.findOne({ 
      where: { code: currency } 
    });
    
    if (!currencyEntity) {
      const errorMsg = `Devise ${currency} non trouvée`;
      if (sessionId && userQuery) {
        this.saveToHistory(sessionId, userQuery, errorMsg);
      }
      throw new Error(errorMsg);
    }


    // 2. Calculer les dates importantes
    const currentDate = new Date();
    const futureDate = new Date();
    futureDate.setDate(currentDate.getDate() + daysAhead);

    // 3. Récupérer les factures impayées ou partiellement payées
    const pendingInvoices = await this.expenseInvoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.currency', 'currency')
      .leftJoinAndSelect('invoice.payments', 'payments')
      .where('invoice.firmId = :firmId', { firmId })
      .andWhere('invoice.status IN (:...statuses)', { 
        statuses: [
          'expense_invoice.status.validated',
          'expense_invoice.status.partially_paid',
          'expense_invoice.status.unpaid'
        ] 
      })
      .andWhere('currency.id = :currencyId', { currencyId: currencyEntity.id })
      .andWhere('invoice.total > :minAmount', { minAmount })
      .andWhere('invoice.dueDate <= :futureDate', { futureDate })
      .andWhere('invoice.dueDate < :currentDate OR invoice.amountPaid < invoice.total', { 
        currentDate 
      })
      .getMany();

    // 4. Formater les résultats
    const lateInvoices = pendingInvoices.map(invoice => {
      const dueDate = new Date(invoice.dueDate);
      
      // Conversion en timestamps avant soustraction
      const currentTimestamp = currentDate.getTime();
      const dueTimestamp = dueDate.getTime();
      
      // Calcul sécurisé
      const timeDiff = currentTimestamp - dueTimestamp;
      const daysLate = Math.floor(timeDiff / (1000 * 60 * 60 * 24)); // ms -> jours
    
      return {
        invoiceNumber: invoice.sequentialNumbr || invoice.sequential || `INV-${invoice.id}`,
        amount: invoice.total,
        amountPaid: invoice.amountPaid || 0,
        currency: currency,
        dueDate: dueDate.toISOString().split('T')[0], // Format YYYY-MM-DD
        daysLate: Math.max(0, daysLate), // On ne veut pas de valeurs négatives
        status: invoice.status.replace('expense_invoice.status.', ''),
        remainingAmount: invoice.total - (invoice.amountPaid || 0)
      };
    });

    // 5. Calculer le total
    const totalRemaining = lateInvoices.reduce(
      (sum, invoice) => sum + invoice.remainingAmount, 0
    );

    let responseText = `Late payments report:\n`;
    responseText += `- Total invoices: ${lateInvoices.length}\n`;
    responseText += `- Total remaining: ${totalRemaining.toFixed(2)} ${currency}\n`;
    responseText += `Invoices:\n`;
    
    lateInvoices.forEach(inv => {
      responseText += `  ${inv.invoiceNumber}: ${inv.remainingAmount} ${currency} (${inv.daysLate} days late)\n`;
    });

    const response = {
      success: true,
      invoices: lateInvoices,
      count: lateInvoices.length,
      totalRemaining: parseFloat(totalRemaining.toFixed(2)),
      formattedResponse: responseText // Ajout de la réponse formatée
    };

    // Sauvegarder dans l'historique si sessionId et userQuery sont fournis
    if (sessionId && userQuery) {
      this.saveToHistory(sessionId, userQuery, responseText);
    }

    return response;

  } catch (error) {
    console.error('Erreur:', error);
    const errorResponse = {
      success: false,
      error: error.message,
      invoices: [],
      count: 0,
      totalRemaining: 0
    };

    // Sauvegarder l'erreur dans l'historique
    if (sessionId && userQuery) {
      this.saveToHistory(sessionId, userQuery, `Error: ${error.message}`);
    }

    return errorResponse;
  }
}


private getMissingParam(params: any): string | null {
  if (!params.firmId) return 'firmId';
  if (!params.currency) return 'currency'; 
  if (!params.minAmount) return 'minAmount';
  if (!params.daysAhead) return 'daysAhead';
  return null;
}


public async getInvoicePayments(
  invoiceNumber: string, 
  lang: string = 'fr',
  sessionId?: string,
  userQuery?: string
) {
  const t = this.getTranslation(lang);
  
  // Validation des entrées
  if (!invoiceNumber) {
    const errorMsg = t.missingNumber(t.invoice);
    if (sessionId) this.saveToHistory(sessionId, userQuery || 'Invoice payment query', errorMsg);
    return { success: false, message: errorMsg };
  }

  try {
    const invoice = await this.expenseInvoiceRepository.findOne({
      where: { sequentialNumbr: invoiceNumber },
      relations: ['payments', 'payments.payment', 'currency']
    });

    if (!invoice) {
      const notFoundMsg = t.notFound(t.invoice, invoiceNumber);
      if (sessionId) this.saveToHistory(sessionId, userQuery || `Payments for ${invoiceNumber}`, notFoundMsg);
      return { success: false, message: notFoundMsg };
    }

    // Calcul des montants
    const payments = invoice.payments || [];
    const paidAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const remainingAmount = invoice.total - paidAmount;

    // Formatage des paiements avec vérification de sécurité
    const formattedPayments = payments
      .filter(p => p.payment?.date) // Filtre les paiements sans date
      .map(p => ({
        id: p.payment?.id,
        amount: p.amount || 0,
        date: p.payment.date,
        mode: this.getPaymentMode(p.payment?.mode, lang),
        notes: p.payment?.notes || ''
      }));

    // Construction de la réponse
    const currencyCode = invoice.currency?.code || 'EUR';
    const paymentLines = formattedPayments.map(p => 
      `- ${p.amount} ${currencyCode} (${p.mode}) ${lang === 'en' ? 'on' : 'le'} ${new Date(p.date).toLocaleDateString(lang)}`
    ).join('\n');

    const responseText = [
      lang === 'en' ? `Payments for invoice ${invoice.sequentialNumbr}:` : `Paiements pour la facture ${invoice.sequentialNumbr}:`,
      paymentLines,
      '',
      lang === 'en' ? `Total: ${invoice.total} ${currencyCode}` : `Total : ${invoice.total} ${currencyCode}`,
      lang === 'en' ? `Paid: ${paidAmount} ${currencyCode}` : `Payé : ${paidAmount} ${currencyCode}`,
      lang === 'en' ? `Remaining: ${remainingAmount} ${currencyCode}` : `Restant : ${remainingAmount} ${currencyCode}`
    ].join('\n');

    // Sauvegarde dans l'historique
    if (sessionId) {
      this.saveToHistory(
        sessionId, 
        userQuery || `Get payments for ${invoiceNumber}`,
        responseText
      );
    }

    return {
      success: true,
      invoiceNumber: invoice.sequentialNumbr,
      total: invoice.total,
      paidAmount,
      remainingAmount,
      currency: currencyCode,
      payments: formattedPayments,
      formattedResponse: responseText
    };

  } catch (error) {
    console.error('Error getting invoice payments:', error);
    const errorMsg = `${t.error}: ${error.message}`;
    
    if (sessionId) {
      this.saveToHistory(
        sessionId, 
        userQuery || `Payment query for ${invoiceNumber}`, 
        errorMsg
      );
    }
    
    return { 
      success: false, 
      message: errorMsg 
    };
  }
}

private getPaymentMode(mode: string | undefined, lang: string): string {
  if (!mode) return lang === 'fr' ? 'Mode inconnu' : 'Unknown mode';

  const modes = {
    [PAYMENT_MODE.Cash]: { en: 'Cash', fr: 'Espèces', es: 'Efectivo' },
    [PAYMENT_MODE.CreditCard]: { en: 'Credit Card', fr: 'Carte de crédit', es: 'Tarjeta de crédito' },
    [PAYMENT_MODE.Check]: { en: 'Check', fr: 'Chèque', es: 'Cheque' },
    [PAYMENT_MODE.BankTransfer]: { en: 'Bank Transfer', fr: 'Virement bancaire', es: 'Transferencia bancaria' },
    [PAYMENT_MODE.WireTransfer]: { en: 'Wire Transfer', fr: 'Virement', es: 'Transferencia' }
  };

  // Nettoyage du mode si nécessaire (enlève les préfixes)
  const cleanMode = mode.replace('payment.payment_mode.', '');
  
  return modes[cleanMode]?.[lang] || 
         modes[cleanMode]?.en || 
         cleanMode;
}

// En haut de la classe, ajoutez cette propriété
private async saveToHistory(sessionId: string, userMessage: string, botResponse: any): Promise<void> {
  try {
    const responseText = typeof botResponse === 'string' 
      ? botResponse 
      : botResponse?.fulfillmentText || JSON.stringify(botResponse);

    const entry: HistoryEntry = {
      user: userMessage.substring(0, 500),
      bot: responseText.substring(0, 2000),
      timestamp: new Date().toISOString()
    };

    // Envoyer un seul entry (pas un tableau)
    await this.historyRepository.saveSessionHistory(sessionId, entry);
  } catch (error) {
    console.error('History save error:', error);
  }
}
public async getHistory(sessionId: string): Promise<string> {
  const { entries } = await this.historyRepository.getFullHistory(sessionId);
  
  if (!entries.length) {
    return "No conversation history available";
  }

  // Afficher du plus ancien au plus récent
  return entries
    .map((entry, index) => 
      `${index + 1}. User: ${entry.user}\n   Bot: ${entry.bot}`
    )
    .join('\n\n');
}
private async handleDataComparison(
  params: {
    data_type: string;
    field_name: string;
    user_value: string | number;
    reference_id: string;
  },
  lang: string = 'fr'
): Promise<{ success: boolean; message: string }> {
  const t = this.getTranslation(lang);

  try {
    // Récupérer le document avec les champs nécessaires
    const document = await this.getDocumentForComparison(params.reference_id);
    if (!document) {
      return {
        success: false,
        message: t.documentNotFound.replace('{reference}', params.reference_id)
      };
    }

    // Vérifier que la valeur utilisateur est valide
    if (params.user_value === null || params.user_value === undefined) {
      return {
        success: false,
        message: t.fieldNotFound.replace('{field}', params.field_name)
      };
    }

    // Comparaison spéciale pour les statuts
    if (params.field_name === 'status') {
      return this.compareStatus(document, params.user_value, lang);
    }

    // Comparaison numérique
    const dbValue = document[params.field_name];
    if (dbValue === undefined) {
      return {
        success: false,
        message: t.fieldNotFound.replace('{field}', params.field_name)
      };
    }

    // Convertir en nombres pour la comparaison
    const userValueNum = typeof params.user_value === 'string' 
      ? parseFloat(params.user_value.replace(',', '.')) 
      : params.user_value;
    const dbValueNum = typeof dbValue === 'string' 
      ? parseFloat(dbValue.replace(',', '.')) 
      : dbValue;

    if (isNaN(userValueNum) || isNaN(dbValueNum)) {
      return {
        success: false,
        message: t.comparisonError
      };
    }

    const epsilon = 0.01; // Tolérance pour les comparaisons de nombres à virgule
    const isEqual = Math.abs(userValueNum - dbValueNum) < epsilon;
    const comparison = isEqual ? 'equal' : 
                      userValueNum > dbValueNum ? 'greater' : 'less';

    const formattedDbValue = this.formatCurrency(dbValueNum, lang);
    const formattedUserValue = this.formatCurrency(userValueNum, lang);

    let message = '';
    if (lang === 'fr') {
      message = `Comparaison pour ${document.sequentialNumbr} (${params.field_name}):\n`;
      message += `- Valeur fournie: ${formattedUserValue}\n`;
      message += `- Valeur en base: ${formattedDbValue}\n`;
      message += comparison === 'equal' 
        ? 'Les valeurs sont identiques.' 
        : `La valeur fournie est ${comparison === 'greater' ? 'supérieure' : 'inférieure'} à celle en base.`;
    } else if (lang === 'es') {
      message = `Comparación para ${document.sequentialNumbr} (${params.field_name}):\n`;
      message += `- Valor proporcionado: ${formattedUserValue}\n`;
      message += `- Valor en base: ${formattedDbValue}\n`;
      message += comparison === 'equal' 
        ? 'Los valores son idénticos.' 
        : `El valor proporcionado es ${comparison === 'greater' ? 'superior' : 'inferior'} al valor en la base.`;
    } else {
      message = `Comparison for ${document.sequentialNumbr} (${params.field_name}):\n`;
      message += `- Provided value: ${formattedUserValue}\n`;
      message += `- Database value: ${formattedDbValue}\n`;
      message += comparison === 'equal' 
        ? 'The values are identical.' 
        : `The provided value is ${comparison === 'greater' ? 'greater' : 'less'} than the database value.`;
    }

    return {
      success: true,
      message
    };

  } catch (error) {
    console.error('Comparison error:', error);
    return {
      success: false,
      message: t.comparisonError
    };
  }
}

private async getDocumentForComparison(referenceId: string): Promise<any> {
  if (referenceId.startsWith('INV-')) {
    return this.expenseInvoiceRepository.findOne({
      where: { sequentialNumbr: referenceId },
      select: ['total', 'status', 'sequentialNumbr'] // Sélectionner explicitement les champs nécessaires
    });
  } else if (referenceId.startsWith('QUO-')) {
    return this.expensQuotationRepository.findOne({
      where: { sequentialNumbr: referenceId },
      select: ['total', 'status', 'sequentialNumbr'] // Sélectionner explicitement les champs nécessaires
    });
  }
  return null;
}
private compareStatus(document: any, userValue: string | number, lang: string) {
  const t = this.getTranslation(lang);
  const dbStatus = document.status?.replace(/^expense_(invoice|quotation)\.status\./, '');
  const normalizedUserValue = String(userValue).toLowerCase();
  
  const isMatch = dbStatus.toLowerCase() === normalizedUserValue;
  
  const statusMessage = lang === 'fr'
    ? `Le statut de ${document.sequentialNumbr} est "${dbStatus}"`
    : `The status of ${document.sequentialNumbr} is "${dbStatus}"`;
  
  const comparisonMessage = isMatch
    ? lang === 'fr' 
      ? 'Ceci correspond à la valeur que vous avez fournie.' 
      : 'This matches the value you provided.'
    : lang === 'fr'
      ? 'Ceci ne correspond pas à la valeur que vous avez fournie.'
      : 'This does not match the value you provided.';
  
  return {
    success: true,
    message: `${statusMessage}\n${comparisonMessage}`
  };
}

}