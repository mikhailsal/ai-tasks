import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function uuidConstraint(column: SQLWrapper): SQL {
  return sql`instr(${column}, char(0)) = 0 AND length(${column}) = 36
    AND substr(${column}, 9, 1) = '-' AND substr(${column}, 14, 1) = '-'
    AND substr(${column}, 19, 1) = '-' AND substr(${column}, 24, 1) = '-'
    AND length(replace(${column}, '-', '')) = 32
    AND replace(${column}, '-', '') NOT GLOB '*[^0-9a-fA-F]*'`;
}

export function integerConstraint(column: SQLWrapper): SQL {
  return sql`typeof(${column}) = 'integer'`;
}

export function positiveInteger(column: SQLWrapper): SQL {
  return sql`${integerConstraint(column)} AND ${column} >= 1`;
}

export function jsonConstraint(column: SQLWrapper): SQL {
  return sql`json_valid(${column})`;
}

export function slugConstraint(column: SQLWrapper): SQL {
  return sql`instr(${column}, char(0)) = 0 AND length(${column}) BETWEEN 1 AND 64
    AND ${column} NOT GLOB '*[^a-z0-9-]*'
    AND substr(${column}, 1, 1) != '-' AND substr(${column}, -1) != '-'
    AND instr(${column}, '--') = 0`;
}
