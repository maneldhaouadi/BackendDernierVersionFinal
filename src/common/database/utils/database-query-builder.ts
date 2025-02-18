import {
  Between,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import {
  ILooseObject,
  IOptionsObject,
  IQueryObject,
  IQueryTypeOrm,
} from '../interfaces/database-query-options.interface';

export class QueryBuilder {
  private options: IOptionsObject;
  constructor(configuration: IOptionsObject = {}) {
    this.options = {
      ...{
        LOOKUP_DELIMITER: '||',
        RELATION_DELIMITER: '.',
        CONDITION_DELIMITER: ';',
        VALUE_DELIMITER: ',',
        EXACT: '$eq',
        NOT: '!',
        CONTAINS: '$cont',
        IS_NULL: '$isnull',
        GT: '$gt',
        GTE: '$gte',
        LT: '$lt',
        LTE: '$lte',
        STARTS_WITH: '$starts',
        ENDS_WITH: '$ends',
        IN: '$in',
        BETWEEN: '$between',
        OR: '$or',
        DEFAULT_LIMIT: '25',
      },
      ...configuration,
    };
  }

  public getOptions() {
    return this.options;
  }
  public build(query: IQueryObject) {
    const output: IQueryTypeOrm = {};
    if (!this.notValid(query.select)) {
      const select = query.select as string;
      output.select = select.split(this.options.VALUE_DELIMITER as string);
    }
    if (!this.notValid(query.join)) {
      const join = query.join as string;
      output.relations = join.split(this.options.VALUE_DELIMITER as string);
    }
    if (!this.notValid(query.sort)) {
      output.order = this.createOrderArray(query.sort as string);
    }
    if (!this.notValid(query.cache)) {
      const cache = query.cache as string;
      output.cache = JSON.parse(cache.toLowerCase());
    }
    if (!this.notValid(query.limit)) {
      const limit = parseInt(query.limit as string, 10);
      // if(!limit){
      //     throw new Error('Limit must be a number.');
      // }
      output.take = limit;
    }
    if (!this.notValid(query.page)) {
      const limit = query.limit || (this.options.DEFAULT_LIMIT as string);
      const limitnum = parseInt(limit, 10);
      output.skip = limitnum * (parseInt(query.page as string, 10) - 1);
      output.take = limitnum;
    }
    if (!this.notValid(query.filter)) {
      output.where = this.createWhere(query.filter as string);
    }

    return output;
  }

  private notValid(value: string | undefined): boolean {
    if (!value) {
      return true;
    }
    return false;
  }

  private createOrderArray(sortString: string): { [key: string]: string } {
    const sortConditions = sortString.split(
      this.options.CONDITION_DELIMITER as string,
    );
    const order: ILooseObject = {};

    sortConditions.forEach((condition) => {
      const [key, value] = condition.split(
        this.options.VALUE_DELIMITER as string,
      );
      if (key) {
        this.assignObjectKey(order, key, (value || 'ASC').toUpperCase());
      }
    });
    return order;
  }

  private createWhere(filterString: string): object[] {
    const queryToAdd: object[] = [];
    const orArray = filterString.split(
      (this.options.LOOKUP_DELIMITER as string) +
        this.options.OR +
        this.options.LOOKUP_DELIMITER,
    );
    orArray.forEach((item) => {
      let obj = {};
      const condition = item.split(this.options.CONDITION_DELIMITER as string);
      const parsedCondition = condition.map((q) =>
        q.split(this.options.LOOKUP_DELIMITER as string),
      );
      parsedCondition.forEach((cond) => {
        let notOperator = false;
        if (cond[1].startsWith(this.options.NOT as string)) {
          notOperator = true;
          const index = (this.options.NOT as string).length;
          cond[1] = cond[1].slice(index);
        }

        obj = {
          ...obj,
          ...this.createWhereObject(cond[0], cond[1], cond[2], notOperator),
        };
      });
      queryToAdd.push(obj);
    });

    return queryToAdd;
  }

  private assignObjectKey(obj: ILooseObject, field: string, value: any) {
    const keyParts = field.split('.');

    let current = obj;

    keyParts.forEach((part, index) => {
      if (index === keyParts.length - 1) {
        current[part] = value;
      } else {
        current[part] = current[part] || {};
        current = current[part];
      }
    });
  }

  private createWhereObject(
    field: string,
    task: string,
    value: string,
    notOperator: boolean,
  ): ILooseObject {
    const obj: ILooseObject = {};
    let condition;

    switch (task) {
      case this.options.EXACT:
        condition = value;
        break;
      case this.options.CONTAINS:
        condition = Like(`%${value}%`);
        break;
      case this.options.STARTS_WITH:
        condition = Like(`${value}%`);
        break;
      case this.options.ENDS_WITH:
        condition = Like(`%${value}`);
        break;
      case this.options.IS_NULL:
        condition = IsNull();
        break;
      case this.options.LT:
        condition = LessThan(this.parseDateOrNumber(value));
        break;
      case this.options.LTE:
        condition = LessThanOrEqual(this.parseDateOrNumber(value));
        break;
      case this.options.GT:
        condition = MoreThan(this.parseDateOrNumber(value));
        break;
      case this.options.GTE:
        condition = MoreThanOrEqual(this.parseDateOrNumber(value));
        break;
      case this.options.IN:
        condition = In(value.split(this.options.VALUE_DELIMITER as string));
        break;
      case this.options.BETWEEN:
        const [start, end] = value.split(
          this.options.VALUE_DELIMITER as string,
        );
        condition = Between(
          this.parseDateOrNumber(start),
          this.parseDateOrNumber(end),
        );
        break;
      default:
        throw new Error(`Unsupported filter task: ${task}`);
    }

    if (notOperator) {
      condition = Not(condition);
    }

    this.assignObjectKey(obj, field, condition);
    return obj;
  }

  private parseDateOrNumber(value: string): Date | number {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const datetimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

    if (dateRegex.test(value)) return new Date(value);
    if (datetimeRegex.test(value)) return new Date(value);

    return parseInt(value, 10);
  }
}
