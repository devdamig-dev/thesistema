import assert from 'node:assert/strict';
import test from 'node:test';
import {moneyCents,decimalMoney,calculateNetSales,calculatePackUnitCost,EMPTY_DEDUCTIONS} from '../lib/calculations/operating-costs';
import {calculateRecipeCost} from '../lib/recipes/quantities';

test('AR amounts from pilot screenshots normalize without silent thousands errors',()=>{
 for(const raw of ['$595.700','595700','595.700,00','ARS 595700.00']) assert.equal(decimalMoney(moneyCents(raw)),'595700.00');
 assert.equal(decimalMoney(moneyCents('$1.234,56')),'1234.56');
 assert.equal(decimalMoney(moneyCents('0,10')),'0.10');
 assert.equal(decimalMoney(moneyCents('-0.10',true)),'-0.10');
 for(const invalid of ['', 'NaN','Infinity','1e3','1,234.56','2,3,4','-1','10000000000','123.4567']) assert.throws(()=>moneyCents(invalid));
});
test('unit cost is derived from the real pack price and quantity',()=>{
 assert.equal(calculatePackUnitCost('12000','24'),500);
 assert.equal(calculatePackUnitCost('$45.000','5'),9000);
 assert.equal(calculatePackUnitCost('100','3'),33.333333);
 assert.equal(calculatePackUnitCost('125,00','0,5'),250);
 assert.equal(calculatePackUnitCost('0','5'),0); // Explicit free input, never a missing input.
 for(const invalid of ['', '0','-2','Infinity','1e5']) assert.throws(()=>calculatePackUnitCost('12000',invalid));
 assert.throws(()=>calculatePackUnitCost('','24'));
});
test('net sales needs only factual gross and deductions, not manual net arithmetic',()=>{
 const result=calculateNetSales('$595.700',{...EMPTY_DEDUCTIONS,discounts:'10000',refunds:'2.000',commissions:'$15.000,50'});
 assert.equal(result.netTotal,'568699.50');assert.equal(result.deductionsTotal,'27000.50');
 assert.match(result.note,/No es ganancia ni efectivo en caja/);
 assert.match(result.note,/Retenciones informadas: 0.00/);
 assert.equal(calculateNetSales('595700',EMPTY_DEDUCTIONS).netTotal,'595700.00');
 assert.equal(calculateNetSales('100',{...EMPTY_DEDUCTIONS,refunds:'100,10'}).netTotal,'-0.10');
 assert.throws(()=>calculateNetSales('100',{...EMPTY_DEDUCTIONS,commissions:''}));
});
test('recipe derives cost from quantities and pack costs instead of the product sale price',()=>{
 const lines=[{quantity:1,unit:'unit',ingredient:{unit:'unit',avg_unit_cost:calculatePackUnitCost('12000','24')}},{quantity:180,unit:'g',ingredient:{unit:'kg',avg_unit_cost:calculatePackUnitCost('45000','5')}}];
 assert.equal(calculateRecipeCost(lines),2120);
});
