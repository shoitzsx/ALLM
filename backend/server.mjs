import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { seedRecebimentos, DEMO_USERS, RECEBIMENTO_STATUS, STATUS_TRANSITIONS, ROLE_STATUS_PERMISSIONS, DOCUMENT_TYPE_OPTIONS, UNIT_OPTIONS, RECEIPT_TYPE_OPTIONS, SUPPLIER_OPTIONS, DIVERGENCE_TYPE_OPTIONS, STATUS_OPTIONS } from '../src/data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'
const DB_FILE = process.env.ALM_DB_FILE || path.join(__dirname, 'data.json')
const UPLOAD_DIR = process.env.ALM_UPLOAD_DIR || path.join(__dirname, 'uploads')

let writeQueue = Promise.resolve()

const clone = (value) => JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()
const uid = (prefix) => `${prefix}-${randomUUID()}`
const actor = (user) => ({ id: user.id, nome: user.nome || user.name, name: user.name || user.nome, iniciais: user.iniciais, perfil: user.perfil || user.role, role: user.role || user.perfil })
const json = (res, status, body, headers = {}) => { const payload = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(payload) }
const error = (res, status, code, message, details) => json(res, status, { error: { code, message, ...(details ? { details } : {}) } })

let db = { recebimentos: [], usuarios: clone(DEMO_USERS) }

async function ensureDb() {
  // API MVP volátil: nenhum dado fictício e nenhuma persistência em disco.
  db = { recebimentos: [], usuarios: clone(DEMO_USERS) }
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
}

async function readDb() { return db }
async function writeDb(nextDb) { db = nextDb; return db }

function userFrom(req) {
  const id = req.headers['x-user-id'] || DEMO_USERS[0]?.id
  return (db.usuarios || []).find((u) => u.id === id) || null
}

function requireUser(req, res) { const user = userFrom(req); if (!user) { error(res, 401, 'UNAUTHORIZED', 'Usuário não autenticado.'); return null } return user }
function requireWrite(user, res) { if ((user.perfil || user.role) === 'Consulta') { error(res, 403, 'FORBIDDEN', 'O perfil Consulta não pode alterar dados.'); return false } return true }
function isAdmin(user) { return (user.perfil || user.role) === 'Administrador' }
function findReceipt(db, id) { return db.recebimentos.find((r) => r.id === id || r.protocolo === id) }
function isNfPending(r) { return !r?.numeroNf || !(r?.anexos || []).some((a) => a.categoria === 'Nota Fiscal' && !a.removido) }
function openDivs(r) { return (r?.divergencias || []).filter((d) => !d.resolvida) }
function validateTransition(r, next, user) {
  if (!r) return 'Recebimento não encontrado.'
  if (!STATUS_OPTIONS.some((s) => s.value === next)) return 'Status inválido.'
  if (r.status === next) return 'O recebimento já está neste status.'
  const role = user.perfil || user.role
  if (role === 'Consulta') return 'O perfil Consulta não pode alterar status.'
  if (!isAdmin(user)) {
    if (!(STATUS_TRANSITIONS[r.status] || []).includes(next)) return 'Essa mudança não faz parte do fluxo permitido.'
    if (!(ROLE_STATUS_PERMISSIONS[role] || []).includes(next)) return `O perfil ${role} não pode mover para este status.`
  }
  if (next === RECEBIMENTO_STATUS.DIVERGENCIA && !openDivs(r).length) return 'Registre uma divergência aberta antes de mudar o status.'
  if (next === RECEBIMENTO_STATUS.FINALIZADO) {
    if (isNfPending(r)) return 'A NF e seu arquivo são obrigatórios para finalizar.'
    if (!(r.itens || []).length) return 'Inclua ao menos um item para finalizar.'
    if (openDivs(r).length) return 'Resolva todas as divergências antes de finalizar.'
  }
  return null
}
function audit(r, user, acao, detalhes) { r.historicoAlteracoes = [...(r.historicoAlteracoes || []), { id: uid('AUD'), data: now(), usuario: actor(user), acao, detalhes }] }
function statusHistory(r, user, de, para, observacao = '') { r.historicoStatus = [...(r.historicoStatus || []), { id: uid('HST'), data: now(), usuario: actor(user), de, para, observacao }] }
function normalizeItem(input = {}, index = 0) { const received = Number(input.quantidadeRecebida ?? input.quantidade ?? 0) || 0; return { id: input.id || uid('IT'), numero: String(input.numero ?? input.item ?? (index + 1) * 10), codigo: String(input.codigo ?? '').trim(), descricao: String(input.descricao ?? '').trim(), quantidadeSolicitada: Number(input.quantidadeSolicitada ?? received) || 0, quantidadeRecebida: received, unidade: input.unidade || 'UN' } }
function nextProtocol(db, date) { const year = String(date || now()).slice(0,4); let max = 0; const re = new RegExp(`^REC-${year}-(\\d+)$`); for (const r of db.recebimentos) { const m = String(r.protocolo || '').match(re); if (m) max = Math.max(max, Number(m[1])) } return `REC-${year}-${String(max + 1).padStart(4,'0')}` }

function validateReceiptInput(input, partial = false) {
  const errors = {}
  if (!partial || 'pedido' in input) if (!String(input.pedido || '').trim()) errors.pedido = 'Pedido é obrigatório.'
  if (!partial || 'fornecedor' in input) if (!String(input.fornecedor || '').trim()) errors.fornecedor = 'Fornecedor é obrigatório.'
  if (!partial || 'dataRecebimento' in input) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.dataRecebimento || ''))) errors.dataRecebimento = 'Data de recebimento inválida.'
  if ('tipo' in input && !RECEIPT_TYPE_OPTIONS.some(o => o.value === input.tipo)) errors.tipo = 'Tipo de recebimento inválido.'
  if ('cnpjFornecedor' in input && input.cnpjFornecedor && !/^\d{2}\.?(\d{3})\.?\d{3}\/?\d{4}-?\d{2}$/.test(String(input.cnpjFornecedor))) errors.cnpjFornecedor = 'CNPJ do fornecedor inválido.'
  if ('itens' in input) {
    if (!Array.isArray(input.itens)) errors.itens = 'Itens deve ser uma lista.'
    else input.itens.forEach((item, i) => { if (!String(item.descricao || '').trim()) errors[`itens.${i}.descricao`] = 'Descrição do item é obrigatória.'; if (!UNIT_OPTIONS.some(o => o.value === item.unidade)) errors[`itens.${i}.unidade`] = 'Unidade inválida.'; if (Number(item.quantidadeRecebida) < 0 || Number(item.quantidadeSolicitada) < 0) errors[`itens.${i}.quantidade`] = 'Quantidade não pode ser negativa.' })
  }
  return Object.keys(errors).length ? errors : null
}

function parseUrl(req) { return new URL(req.url, `http://${req.headers.host || 'localhost'}`) }
async function body(req) { const chunks=[]; for await (const c of req) chunks.push(c); const raw=Buffer.concat(chunks).toString('utf8'); if (!raw) return {}; try { return JSON.parse(raw) } catch { throw new Error('JSON inválido.') } }
function routeParts(url) { return url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean) }
function match(parts, pattern) { if (parts.length !== pattern.length) return false; return pattern.every((p,i)=>p.startsWith(':') || p===parts[i]) }

async function handle(req, res) {
  const url = parseUrl(req); const parts = routeParts(url)
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-User-Id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' }); return res.end() }
  if (!url.pathname.startsWith('/api/v1')) return error(res,404,'NOT_FOUND','Rota não encontrada.')
  try { db = await readDb() } catch { return error(res,500,'DATABASE_ERROR','Não foi possível ler os dados em memória.') }
  const user = requireUser(req,res); if (!user) return

  try {
    if (match(parts,['auth','me']) && req.method==='GET') return json(res,200,{ ...actor(user), email:user.email, permissoes: permissions(user) })
    if (match(parts,['catalogos']) && req.method==='GET') return json(res,200,{ status:STATUS_OPTIONS, unidades:UNIT_OPTIONS, tiposRecebimento:RECEIPT_TYPE_OPTIONS, fornecedores:SUPPLIER_OPTIONS, tiposDocumento:DOCUMENT_TYPE_OPTIONS, tiposDivergencia:DIVERGENCE_TYPE_OPTIONS })
    if (match(parts,['usuarios']) && req.method==='GET') return json(res,200,{data:db.usuarios || []})
    if (match(parts,['usuarios']) && req.method==='POST') { if(!isAdmin(user)) return error(res,403,'FORBIDDEN','Somente administrador pode criar usuários.'); const input=await body(req); if(!input.nome||!input.email||!input.perfil) return error(res,422,'VALIDATION_ERROR','Nome, e-mail e perfil são obrigatórios.'); if(!['Administrador','Almoxarifado','Suprimentos','Consulta'].includes(input.perfil)) return error(res,422,'VALIDATION_ERROR','Perfil inválido.'); const u={id:input.id||uid('USR'),nome:String(input.nome).trim(),name:String(input.nome).trim(),iniciais:String(input.nome).split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(),email:String(input.email).trim(),perfil:input.perfil,role:input.perfil,ativo:input.ativo!==false}; db.usuarios=[...(db.usuarios||[]),u]; await writeDb(db); return json(res,201,u) }
    if (parts[0]==='usuarios' && parts.length===2 && req.method==='GET') { const u=(db.usuarios||[]).find(x=>x.id===parts[1]); return u?json(res,200,u):error(res,404,'USER_NOT_FOUND','Usuário não encontrado.') }
    if (parts[0]==='usuarios' && parts.length===2 && req.method==='PATCH') { if(!isAdmin(user)) return error(res,403,'FORBIDDEN','Somente administrador pode editar usuários.'); const u=(db.usuarios||[]).find(x=>x.id===parts[1]); if(!u)return error(res,404,'USER_NOT_FOUND','Usuário não encontrado.'); const input=await body(req); if(input.perfil&&!['Administrador','Almoxarifado','Suprimentos','Consulta'].includes(input.perfil))return error(res,422,'VALIDATION_ERROR','Perfil inválido.'); Object.assign(u,input,{id:u.id}); u.name=u.nome;u.role=u.perfil;await writeDb(db);return json(res,200,u) }

    if (match(parts,['recebimentos']) && req.method==='GET') {
      let rows = url.searchParams.get('includeArchived') === 'true' ? db.recebimentos : db.recebimentos.filter(r=>!r.arquivado)
      const q=(url.searchParams.get('q')||'').toLowerCase().trim(); const status=url.searchParams.get('status'); const fornecedor=url.searchParams.get('fornecedor'); const pedido=url.searchParams.get('pedido'); const nf=url.searchParams.get('numeroNf');
      if(q) rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q)); if(status) rows=rows.filter(r=>r.status===status); if(fornecedor) rows=rows.filter(r=>r.fornecedor===fornecedor); if(pedido) rows=rows.filter(r=>r.pedido===pedido); if(nf) rows=rows.filter(r=>r.numeroNf===nf)
      const orderBy=url.searchParams.get('orderBy')||'dataRecebimento'; const dir=url.searchParams.get('order')==='asc'?1:-1; rows.sort((a,b)=>String(a[orderBy]||'').localeCompare(String(b[orderBy]||''))*dir)
      const page=Math.max(1,Number(url.searchParams.get('page')||1)); const pageSize=Math.min(100,Math.max(1,Number(url.searchParams.get('pageSize')||50))); const total=rows.length
      return json(res,200,{data:rows.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize))}})
    }
    if (match(parts,['recebimentos']) && req.method==='POST') {
      if(!requireWrite(user,res)) return; const input=await body(req); const validation=validateReceiptInput(input); if(validation) return error(res,422,'VALIDATION_ERROR','Dados do recebimento inválidos.',validation); const timestamp=now(); const date=input.dataRecebimento||new Date().toISOString().slice(0,10); const protocol=input.protocolo||nextProtocol(db,date); if(db.recebimentos.some(r=>r.protocolo===protocol)) return error(res,409,'PROTOCOL_EXISTS','Protocolo já existe.')
      const r={id:input.id||protocol,protocolo:protocol,pedido:String(input.pedido||'').trim(),numeroNf:String(input.numeroNf||'').trim()||null,serieNf:String(input.serieNf||'').trim()||null,dataRecebimento:date,fornecedor:String(input.fornecedor||'').trim(),cnpjFornecedor:String(input.cnpjFornecedor||'').trim(),tipo:input.tipo||'Estoque',responsavel:actor(user),status:RECEBIMENTO_STATUS.DIGITACAO,observacoes:String(input.observacoes||'').trim(),criadoEm:timestamp,atualizadoEm:timestamp,itens:(input.itens||[]).map(normalizeItem),anexos:[],divergencias:[],historicoStatus:[],historicoAlteracoes:[],arquivado:false}
      statusHistory(r,user,null,r.status,'Registro criado.'); audit(r,user,'Recebimento criado',`Protocolo ${protocol}.`); db.recebimentos.unshift(r); await writeDb(db); return json(res,201,r)
    }
    if (parts[0]==='recebimentos' && parts.length===2 && req.method==='GET') { const r=findReceipt(db,parts[1]); return r?json(res,200,r):error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.') }
    if (parts[0]==='recebimentos' && parts.length===2 && req.method==='PATCH') {
      if(!requireWrite(user,res)) return; const r=findReceipt(db,parts[1]); if(!r) return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.'); if(r.status===RECEBIMENTO_STATUS.FINALIZADO&&!isAdmin(user)) return error(res,403,'FINALIZED_LOCKED','Somente um administrador pode editar um recebimento finalizado.')
      const input=await body(req); const validation=validateReceiptInput(input,true); if(validation) return error(res,422,'VALIDATION_ERROR','Dados do recebimento inválidos.',validation); const blocked=new Set(['id','protocolo','responsavel','status','historicoStatus','historicoAlteracoes','criadoEm','anexos','divergencias']); const changes={}; for(const [k,v] of Object.entries(input)) if(!blocked.has(k)) changes[k]=v; if('numeroNf' in changes) changes.numeroNf=String(changes.numeroNf||'').trim()||null; if('serieNf' in changes) changes.serieNf=String(changes.serieNf||'').trim()||null; if('pedido' in changes) changes.pedido=String(changes.pedido||'').trim(); r=Object.assign(r,changes,{atualizadoEm:now()}); audit(r,user,'Dados alterados',`Campos atualizados: ${Object.keys(changes).join(', ')}.`); await writeDb(db); return json(res,200,r)
    }

    if(parts[0]==='recebimentos'&&parts[2]==='itens') { const r=findReceipt(db,parts[1]); if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.'); if(req.method==='GET'&&parts.length===3)return json(res,200,{data:r.itens||[]}); if(!requireWrite(user,res))return; if(r.status===RECEBIMENTO_STATUS.FINALIZADO&&!isAdmin(user))return error(res,403,'FINALIZED_LOCKED','Recebimento finalizado.');
      if(req.method==='POST'&&parts.length===3){const i=normalizeItem(await body(req),(r.itens||[]).length);r.itens=[...(r.itens||[]),i];r.atualizadoEm=now();audit(r,user,'Item incluído',i.descricao||i.numero);await writeDb(db);return json(res,201,i)}
      if(parts.length===4){const idx=r.itens.findIndex(i=>i.id===parts[3]);if(idx<0)return error(res,404,'ITEM_NOT_FOUND','Item não encontrado.'); if(req.method==='PATCH'){const i=normalizeItem({...r.itens[idx],...(await body(req))},idx);r.itens[idx]=i;r.atualizadoEm=now();audit(r,user,'Item alterado',i.descricao||i.numero);await writeDb(db);return json(res,200,i)} if(req.method==='DELETE'){if((r.divergencias||[]).some(d=>d.itemId===parts[3]))return error(res,409,'ITEM_HAS_DIVERGENCE','O item possui divergências vinculadas e não pode ser removido.');const [removed]=r.itens.splice(idx,1);r.atualizadoEm=now();audit(r,user,'Item removido',removed.descricao||removed.numero);await writeDb(db);return json(res,200,removed)}} }

    if(parts[0]==='recebimentos'&&parts[2]==='anexos'){const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');if(req.method==='GET'&&parts.length===3)return json(res,200,{data:(r.anexos||[]).filter(a=>!a.removido)});if(!requireWrite(user,res))return;if(r.status===RECEBIMENTO_STATUS.FINALIZADO&&!isAdmin(user))return error(res,403,'FINALIZED_LOCKED','Recebimento finalizado.');if(req.method==='POST'&&parts.length===3){const input=await body(req);if(!input.dataBase64)return error(res,422,'FILE_REQUIRED','Arquivo obrigatório.');const buffer=Buffer.from(input.dataBase64,'base64');const max=15*1024*1024;if(buffer.length>max)return error(res,422,'FILE_TOO_LARGE','Arquivo excede 15 MB.');const safeName=String(input.name||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_');const key=`${uid('FILE')}-${safeName}`;await fs.writeFile(path.join(UPLOAD_DIR,key),buffer);const a={id:uid('ANX'),nome:String(input.name||safeName),categoria:input.categoria||'Outro',tipo:input.categoria||'Outro',mimeType:input.mimeType||'application/octet-stream',tamanho:buffer.length,dataInclusao:now(),incluidoPor:actor(user),storageKey:key,url:`/api/v1/anexos/${key}/download`,removido:false};r.anexos=[...(r.anexos||[]),a];r.atualizadoEm=now();audit(r,user,'Arquivo incluído',a.nome);await writeDb(db);return json(res,201,a)}if(parts.length===4){const a=(r.anexos||[]).find(x=>x.id===parts[3]);if(!a)return error(res,404,'ATTACHMENT_NOT_FOUND','Arquivo não encontrado.');if(req.method==='DELETE'){a.removido=true;a.removidoEm=now();a.removidoPor=actor(user);a.motivoRemocao=(await body(req)).reason||'';r.atualizadoEm=now();audit(r,user,'Arquivo removido',a.nome);await writeDb(db);return json(res,200,a)}}}

    if(parts[0]==='recebimentos'&&parts[2]==='divergencias'){const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');if(req.method==='GET'&&parts.length===3)return json(res,200,{data:r.divergencias||[]});if(!requireWrite(user,res))return;if(req.method==='POST'&&parts.length===3){const input=await body(req);const desc=String(input.descricao||'').trim();if(!desc)return error(res,422,'DESCRIPTION_REQUIRED','Descreva a divergência encontrada.');if(input.itemId&&!(r.itens||[]).some(i=>i.id===input.itemId))return error(res,422,'ITEM_NOT_FOUND','O item vinculado à divergência não foi encontrado.');const d={id:uid('DIV'),tipo:input.tipo||'Outro',descricao:desc,itemId:input.itemId||null,criadaEm:now(),criadaPor:actor(user),resolvida:false,resolvidaEm:null,resolvidaPor:null,resolucao:''};r.divergencias=[...(r.divergencias||[]),d];if(r.status===RECEBIMENTO_STATUS.CONFERENCIA){statusHistory(r,user,r.status,RECEBIMENTO_STATUS.DIVERGENCIA,'Divergência registrada.');r.status=RECEBIMENTO_STATUS.DIVERGENCIA}r.atualizadoEm=now();audit(r,user,'Divergência registrada',`${d.tipo}: ${d.descricao}`);await writeDb(db);return json(res,201,d)}if(parts.length===5){const d=r.divergencias.find(x=>x.id===parts[3]);if(!d)return error(res,404,'DIVERGENCE_NOT_FOUND','Divergência não encontrada.');const action=parts[4];if(action==='resolver'&&req.method==='POST'){const input=await body(req);const resolution=String(input.resolucao||input.resolution||'').trim();if(!resolution)return error(res,422,'RESOLUTION_REQUIRED','Informe como a divergência foi resolvida.');d.resolvida=true;d.resolvidaEm=now();d.resolvidaPor=actor(user);d.resolucao=resolution;audit(r,user,'Divergência resolvida',resolution);await writeDb(db);return json(res,200,d)}if(action==='reabrir'&&req.method==='POST'){const input=await body(req);d.resolvida=false;d.resolvidaEm=null;d.resolvidaPor=null;d.resolucao='';audit(r,user,'Divergência reaberta',input.reason||d.descricao);await writeDb(db);return json(res,200,d)}}}

    if(parts[0]==='recebimentos'&&parts[2]==='status'&&parts.length===3&&req.method==='POST'){if(!requireWrite(user,res))return;const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');const input=await body(req);const reason=validateTransition(r,input.status,user);if(reason&&!input.force)return error(res,422,'INVALID_STATUS_TRANSITION',reason);if(input.force&&!isAdmin(user))return error(res,403,'FORBIDDEN','Somente administrador pode forçar transições.');const previous=r.status;r.status=input.status;r.atualizadoEm=now();statusHistory(r,user,previous,input.status,input.observacao||input.note||'');audit(r,user,'Status alterado',`${previous} → ${input.status}.`);await writeDb(db);return json(res,200,{recebimentoId:r.id,statusAnterior:previous,status:r.status,alteradoPor:actor(user),alteradoEm:r.atualizadoEm})}
    if(parts[0]==='recebimentos'&&parts[2]==='historico'&&parts[3]==='status'&&req.method==='GET'){const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');return json(res,200,{data:r.historicoStatus||[]})}
    if(parts[0]==='recebimentos'&&parts[2]==='historico'&&parts[3]==='auditoria'&&req.method==='GET'){const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');return json(res,200,{data:r.historicoAlteracoes||[]})}
    if(parts[0]==='recebimentos'&&parts[2]==='arquivar'&&parts.length===3&&req.method==='POST'){if(!isAdmin(user))return error(res,403,'FORBIDDEN','Somente um administrador pode arquivar registros.');const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');const input=await body(req);r.arquivado=true;r.arquivadoEm=now();r.arquivadoPor=actor(user);r.atualizadoEm=now();audit(r,user,'Recebimento arquivado',input.reason||'Sem motivo informado.');await writeDb(db);return json(res,200,r)}
    if(parts[0]==='recebimentos'&&parts[2]==='restaurar'&&parts.length===3&&req.method==='POST'){if(!isAdmin(user))return error(res,403,'FORBIDDEN','Somente um administrador pode restaurar registros.');const r=findReceipt(db,parts[1]);if(!r)return error(res,404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');r.arquivado=false;r.restauradoEm=now();r.atualizadoEm=now();audit(r,user,'Recebimento restaurado',r.protocolo);await writeDb(db);return json(res,200,r)}
    if(parts[0]==='dashboard'&&req.method==='GET'){const rows=db.recebimentos.filter(r=>!r.arquivado);const counts=Object.fromEntries(STATUS_OPTIONS.map(s=>[s.value,rows.filter(r=>r.status===s.value).length]));return json(res,200,{total:rows.length,status:counts,nfPendentes:rows.filter(isNfPending).length,divergencias:rows.filter(r=>openDivs(r).length>0).length})}
    if(parts[0]==='anexos'&&parts.length===3&&parts[2]==='download'&&req.method==='GET'){const key=path.basename(parts[1]);const file=path.join(UPLOAD_DIR,key);try{const stat=await fs.stat(file);res.writeHead(200,{'Content-Length':stat.size,'Content-Type':'application/octet-stream','Access-Control-Allow-Origin':'*'});return res.end(await fs.readFile(file))}catch{return error(res,404,'FILE_NOT_FOUND','Arquivo não encontrado.')}}
    return error(res,404,'NOT_FOUND','Endpoint não encontrado.')
  } catch (e) { console.error(e); return error(res,500,'INTERNAL_ERROR',e.message||'Erro interno.') }
}
function permissions(user){const role=user.perfil||user.role; if(role==='Consulta')return ['recebimentos.read','itens.read','anexos.read','divergencias.read','historico.read']; return ['recebimentos.read','recebimentos.create','recebimentos.update','itens.read','itens.write','anexos.read','anexos.write','divergencias.read','divergencias.write','status.write',...(role==='Administrador'?['recebimentos.archive','usuarios.write','auditoria.read']:[])]}
await ensureDb()
http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin',process.env.CORS_ORIGIN||'*');handle(req,res)}).listen(PORT,HOST,()=>console.log(`ALM API em http://${HOST}:${PORT}/api/v1`))
