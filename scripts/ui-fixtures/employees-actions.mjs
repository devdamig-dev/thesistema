// Fictitious, isolated UI fixtures. Never imports production actions or Supabase.
import { clone, makeState } from './state.mjs';
const { state, pause, stamp } = makeState({ createCalls: 0, updateCalls: 0, statusCalls: 0, verifyCalls: 0, listQueries: [], writes: [], failLoad: false });
const branchId = '22222222-2222-4222-8222-222222222211';
const blank = { role: 'Rol QA ficticio', shift: 'Turno QA', branchId, monthlyHours: 160, monthlyCost: 500000, pendingAdvance: 10000, absences: 1, lateArrivals: 2, updatedAt: '2026-10-09T12:00:00.000Z' };
state.employees = [
 { ...blank, id: '22222222-2222-4222-8222-222222222221', fullName: 'Empleado QA Ficticio Inicial', active: true },
 { ...blank, id: '22222222-2222-4222-8222-222222222222', fullName: 'Empleado QA Ficticio Archivado', active: false },
];
const reject = (error) => ({ ok: false, persisted: false, status: 'rejected', error });
const uncertain = () => ({ ok: false, persisted: null, status: 'uncertain', error: 'QA ficticio: respuesta incierta; verificá lo guardado.' });
const rowFrom = (input, active = true) => ({ id: input.id, fullName: input.fullName.trim(), role: input.role.trim(), shift: input.shift.trim() || null, branchId: input.branchId, monthlyHours: Number(input.monthlyHours), monthlyCost: Number(input.monthlyCost), pendingAdvance: Number(input.pendingAdvance), absences: Number(input.absences), lateArrivals: Number(input.lateArrivals), active, updatedAt: stamp() });
function response(row) {
 if (state.response === 'uncertain') return uncertain();
 if (state.response === 'throw-after-commit') throw new Error('QA ficticio: respuesta perdida después de guardar.');
 return { ok: true, persisted: true, id: row.id, employee: clone(row) };
}
export async function getEmployeesPageDataAction(input = {}) {
 state.listQueries.push(clone(input));
 if (state.failLoad) return { ok: false, error: 'QA ficticio: no pudimos cargar el equipo.' };
 const rows = state.employees.filter((row) => (input.status === 'all' || row.active === (input.status !== 'archived')) && (!input.branchId || row.branchId === input.branchId) && row.fullName.toLocaleLowerCase().includes((input.query || '').toLocaleLowerCase()));
 const page = input.page || 0;
 return { ok: true, data: { employees: clone(rows.slice(page * 30, (page + 1) * 30)), branches: [{ id: branchId, name: 'Sucursal QA Ficticia' }], count: rows.length, page, pageSize: 30, canManage: state.canManage, draftScope: 'qa-ficticio:user:business', activeCount: rows.filter((r) => r.active).length, totalMonthlyCost: rows.filter((r) => r.active).reduce((s,r) => s+r.monthlyCost,0), pendingAdvances: rows.reduce((s,r) => s+r.pendingAdvance,0), totalAbsences: rows.reduce((s,r) => s+r.absences,0), totalLateArrivals: rows.reduce((s,r) => s+r.lateArrivals,0) } };
}
export async function createEmployeeManualAction(input) {
 state.createCalls++; state.writes.push({ kind: 'create', ...clone(input) }); await pause();
 if (!state.canManage) return reject('QA ficticio: permiso denegado.');
 if (state.response === 'uncertain-before') return uncertain();
 if (state.response === 'rejected') return reject('QA ficticio: datos rechazados.');
 const existing = state.employees.find((row) => row.id === input.id);
 if (existing) return response(existing);
 const row = rowFrom(input); state.employees.push(row); return response(row);
}
export async function updateEmployeeManualAction(input) {
 state.updateCalls++; state.writes.push({ kind: 'update', ...clone(input) }); await pause();
 if (!state.canManage) return reject('QA ficticio: permiso denegado.');
 const existing = state.employees.find((row) => row.id === input.id);
 if (!existing || existing.updatedAt !== input.expectedUpdatedAt) return { ok: false, persisted: false, status: 'conflict', error: 'QA ficticio: versión desactualizada.' };
 const row = rowFrom(input, existing.active); state.employees = state.employees.map((item) => item.id === row.id ? row : item); return response(row);
}
export async function setEmployeeActiveAction(input) {
 state.statusCalls++; state.writes.push({ kind: 'status', ...clone(input) }); await pause();
 if (!state.canManage) return reject('QA ficticio: permiso denegado.');
 const existing = state.employees.find((row) => row.id === input.id);
 if (!existing || existing.updatedAt !== input.expectedUpdatedAt) return { ok: false, persisted: false, status: 'conflict', error: 'QA ficticio: versión desactualizada.' };
 const row = { ...existing, active: input.active, updatedAt: stamp() }; state.employees = state.employees.map((item) => item.id === row.id ? row : item); return response(row);
}
export async function getEmployeeManualAction(id) { state.verifyCalls++; return { ok: true, employee: clone(state.employees.find((row) => row.id === id) || null) }; }
export async function exportEmployeesCsvAction() { return { ok: true, persisted: true, filename: 'empleados-qa.csv', content: 'Empleado\nFixture QA', rows: state.employees.length }; }
