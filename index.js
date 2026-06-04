const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const fetch = require('node-fetch');

const app = express();

// ==========================================
// CONFIGURAÇÃO DO FIREBASE VIA REST API
// ==========================================
const FIREBASE_DB_URL = 'https://pad-saude-default-rtdb.firebaseio.com';

// Funções auxiliares para Firebase REST API
async function dbGet(path) {
    try {
        const response = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
        const data = await response.json();
        return data || {};
    } catch (error) {
        console.error('Erro no dbGet:', error);
        return {};
    }
}

async function dbSet(path, data) {
    try {
        const response = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
            method: 'PUT',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' }
        });
        return await response.json();
    } catch (error) {
        console.error('Erro no dbSet:', error);
        return null;
    }
}

async function dbDelete(path) {
    try {
        const response = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
            method: 'DELETE'
        });
        return await response.json();
    } catch (error) {
        console.error('Erro no dbDelete:', error);
        return null;
    }
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Sessões por usuário (em memória)
const sessoes = {};

const cidadesDisponiveis = {
    1: { 
        nome: "Caruaru-PE", 
        endereco: "R. Nossa Senhora de Fátima, 78, Maurício de Nassau",
        enderecoCompleto: "R. Nossa Senhora de Fátima, 78 - Maurício de Nassau, Caruaru - PE, 55034-105"
    },
    2: { 
        nome: "Recife-PE (Madalena)", 
        endereco: "R. Hermógenes de Morais, 317, Madalena",
        enderecoCompleto: "R. Hermógenes de Morais, 317 - Madalena, Recife - PE, 50710-120"
    },
    3: { 
        nome: "Recife-PE (Home Care)", 
        endereco: "R. José Higino, 247, Madalena",
        enderecoCompleto: "R. José Higino, 247 - Madalena, Recife - PE, 50710-190"
    }
};

const especialidades = {
    1: "Clínico Geral",
    2: "Cardiologia",
    3: "Dermatologia",
    4: "Pediatria"
};

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]/g, '');
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    
    let soma = 0;
    let resto;
    
    for (let i = 1; i <= 9; i++) {
        soma += parseInt(cpf.substring(i-1, i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    
    soma = 0;
    for (let i = 1; i <= 10; i++) {
        soma += parseInt(cpf.substring(i-1, i)) * (12 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(cpf.substring(10, 11));
}

function formatarCPF(cpf) {
    cpf = cpf.replace(/[^\d]/g, '');
    if (cpf.length === 11) {
        return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    return cpf;
}

function validarDataNascimento(dataStr) {
    const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    if (!regex.test(dataStr)) return false;
    
    const dia = parseInt(RegExp.$1);
    const mes = parseInt(RegExp.$2) - 1;
    const ano = parseInt(RegExp.$3);
    
    const data = new Date(ano, mes, dia);
    if (data.getFullYear() !== ano || data.getMonth() !== mes || data.getDate() !== dia) return false;
    
    const hoje = new Date();
    let idade = hoje.getFullYear() - ano;
    const mesDiff = hoje.getMonth() - mes;
    if (mesDiff < 0 || (mesDiff === 0 && hoje.getDate() < dia)) idade--;
    
    return idade >= 0 && idade <= 120;
}

function validarTelefone(telefone) {
    const telLimpo = telefone.replace(/[^\d]/g, '');
    return telLimpo.length >= 10 && telLimpo.length <= 11 && parseInt(telLimpo.substring(0, 2)) >= 11;
}

function formatarTelefone(telefone) {
    let tel = telefone.replace(/[^\d]/g, '');
    if (tel.length === 10) {
        return tel.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    } else if (tel.length === 11) {
        return tel.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    }
    return telefone;
}

function getAvailableSlots(specialty, excludeDateStr = null) {
    const slots = [];
    const today = new Date();
    let startDate = new Date(today);
    
    if (excludeDateStr) {
        const parts = excludeDateStr.split('/');
        if (parts.length === 3) {
            const excludeDate = new Date(parts[2], parts[1] - 1, parts[0]);
            if (excludeDate > today) {
                startDate = new Date(excludeDate);
                startDate.setDate(startDate.getDate() + 1);
            }
        }
    }
    
    for (let i = 1; i <= 15; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        const dayStr = date.toLocaleDateString('pt-BR');
        const possibleHours = ["08:00", "09:30", "11:00", "14:00", "15:30", "17:00"];
        
        for (let hour of possibleHours) {
            let ocupado = false;
            if ((hour === "08:00" && i % 3 === 0) || (hour === "17:00" && i % 4 === 0)) ocupado = true;
            if (!ocupado) slots.push({ date: dayStr, time: hour, dateObj: date });
        }
    }
    return slots.slice(0, 12);
}

function gerarLinkMapa(enderecoCompleto) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoCompleto)}`;
}

function formatarMensagemConfirmacao(dados) {
    return `
✅ *CONSULTA AGENDADA!*

👤 *Paciente:* ${dados.nome}
🆔 *CPF:* ${dados.cpf}
🎂 *Nasc:* ${dados.dataNascimento}
📍 *Unidade:* ${dados.cidadeInfo.nome}
📌 *Data:* ${dados.slotSelecionado.date} às ${dados.slotSelecionado.time}
🔬 *Especialidade:* ${dados.especialidade}
🔖 *ID:* ${dados.id}

🏥 *Endereço:*
${dados.cidadeInfo.enderecoCompleto}

🗺️ *Como chegar:* ${dados.linkMapa}

─────────────────────

✨ *Obrigado por escolher a PAD SAÚDE!* ✨
💚 Tenha um excelente dia!

─────────────────────

💡 Digite *MENU* para voltar
    `.trim();
}

async function gerarIdUnico() {
    const todasConsultas = await dbGet('consultas');
    let maxNum = 1000;
    if (todasConsultas) {
        Object.values(todasConsultas).forEach(cons => {
            if (cons.id && cons.id.startsWith('PAD-')) {
                const num = parseInt(cons.id.split('-')[1]);
                if (!isNaN(num) && num > maxNum) maxNum = num;
            }
        });
    }
    return `PAD-${maxNum + 1}`;
}

async function buscarPacientePorCPF(cpf) {
    const cpfLimpo = cpf.replace(/[^\d]/g, '');
    const pacientes = await dbGet('pacientes');
    return pacientes ? pacientes[cpfLimpo] : null;
}

async function salvarPaciente(cpf, nome, dataNascimento, telefone) {
    const cpfLimpo = cpf.replace(/[^\d]/g, '');
    const pacienteData = {
        nome: nome,
        cpf: formatarCPF(cpf),
        dataNascimento: dataNascimento,
        telefone: formatarTelefone(telefone),
        criadoEm: new Date().toISOString()
    };
    await dbSet(`pacientes/${cpfLimpo}`, pacienteData);
}

async function getConsultasAtivasPorCPF(cpf) {
    if (!cpf) return [];
    const cpfLimpo = cpf.replace(/[^\d]/g, '');
    const consultasData = await dbGet('consultas');
    
    const ativas = [];
    if (consultasData) {
        for (const [id, consulta] of Object.entries(consultasData)) {
            const consultaCPF = consulta.paciente?.cpf?.replace(/[^\d]/g, '') || '';
            if (consultaCPF === cpfLimpo && consulta.status !== 'CANCELADO') {
                ativas.push({ id, ...consulta });
            }
        }
    }
    return ativas;
}

function formatarMenuPrincipal() {
    return `
🏥 *PAD SAÚDE*

1️⃣ Agendar consulta
2️⃣ Cancelar agendamento
3️⃣ Remarcar consulta
4️⃣ Ver minhas consultas

Digite o número da opção:
    `.trim();
}

// ==========================================
// ROTA DE TESTE
// ==========================================
app.get('/', (req, res) => {
    res.send('🤖 Bot PAD Saúde está online! Use o webhook em /whatsapp');
});

// ==========================================
// WEBHOOK DO WHATSAPP
// ==========================================
app.post('/whatsapp', async (req, res) => {
    console.log('\n=== NOVA MENSAGEM RECEBIDA ===');
    
    let numeroUsuario = req.body.From || req.body.From_;
    let textoOriginal = req.body.Body || req.body.Body_;
    
    if (numeroUsuario) {
        numeroUsuario = numeroUsuario.replace('whatsapp:', '');
    }
    
    if (!textoOriginal) {
        const twiml = new MessagingResponse();
        twiml.message('❌ Erro: Nenhuma mensagem recebida.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    textoOriginal = textoOriginal.trim();
    const textoLower = textoOriginal.toLowerCase();
    
    console.log(`📱 De: ${numeroUsuario}`);
    console.log(`💬 Mensagem: "${textoOriginal}"`);
    
    const twiml = new MessagingResponse();
    
    // Inicializa sessão
    if (!sessoes[numeroUsuario]) {
        sessoes[numeroUsuario] = { 
            step: 0, 
            dados: {
                nome: null,
                cpf: null,
                dataNascimento: null,
                telefone: null,
                especialidade: null,
                cidadeInfo: null,
                slots: [],
                slotSelecionado: null,
                consultasParaCancelar: [],
                consultasParaRemarcar: [],
                consultaOriginal: null,
                novoSlot: null,
                cancelamentoId: null
            }
        };
    }
    
    const sessao = sessoes[numeroUsuario];
    let resposta = '';
    
    try {
        // Comando de reset
        if (textoLower === 'menu' || textoLower === 'sair' || textoLower === 'cancelar') {
            sessao.step = 0;
            sessao.dados = {
                nome: null, cpf: null, dataNascimento: null, telefone: null,
                especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                novoSlot: null, cancelamentoId: null
            };
            resposta = formatarMenuPrincipal();
        }
        
        // ==========================================
        // MENU PRINCIPAL (step 0)
        // ==========================================
        else if (sessao.step === 0) {
            if (textoOriginal === '1') {
                sessao.step = 1;
                resposta = '📝 *Agendar consulta*\n\nInforme seu *nome completo*:';
            } 
            else if (textoOriginal === '2') {
                sessao.step = 20;
                resposta = '🗑️ *Cancelar consulta*\n\nInforme seu *CPF* (apenas números):';
            } 
            else if (textoOriginal === '3') {
                sessao.step = 30;
                resposta = '🔄 *Remarcar consulta*\n\nInforme seu *CPF* (apenas números):';
            } 
            else if (textoOriginal === '4') {
                sessao.step = 40;
                resposta = '🔍 *Ver consultas*\n\nInforme seu *CPF* (apenas números):';
            } 
            else {
                resposta = formatarMenuPrincipal();
            }
        }
        
        // ==========================================
        // FLUXO DE AGENDAMENTO (steps 1-8)
        // ==========================================
        else if (sessao.step === 1) {
            if (textoOriginal.length < 3) {
                resposta = '❌ Nome inválido. Informe seu nome completo:';
            } else {
                sessao.dados.nome = textoOriginal;
                sessao.step = 2;
                resposta = `✅ Nome: ${sessao.dados.nome}\n\nAgora informe seu *CPF* (apenas números):`;
            }
        }
        else if (sessao.step === 2) {
            const cpfLimpo = textoOriginal.replace(/[^\d]/g, '');
            if (!validarCPF(cpfLimpo)) {
                resposta = '❌ CPF inválido! Informe um CPF válido:';
            } else {
                sessao.dados.cpf = cpfLimpo;
                sessao.step = 3;
                resposta = `✅ CPF: ${formatarCPF(cpfLimpo)}\n\nInforme sua *DATA DE NASCIMENTO* (DD/MM/AAAA):`;
            }
        }
        else if (sessao.step === 3) {
            if (!validarDataNascimento(textoOriginal)) {
                resposta = '❌ Data inválida! Use DD/MM/AAAA (ex: 15/05/1990):';
            } else {
                sessao.dados.dataNascimento = textoOriginal;
                sessao.step = 4;
                resposta = `✅ Data: ${textoOriginal}\n\nInforme seu *TELEFONE* (ex: 81912345678):`;
            }
        }
        else if (sessao.step === 4) {
            if (!validarTelefone(textoOriginal)) {
                resposta = '❌ Telefone inválido! Use DDD + número (ex: 81912345678):';
            } else {
                sessao.dados.telefone = textoOriginal;
                sessao.step = 5;
                resposta = `✅ Telefone: ${formatarTelefone(textoOriginal)}\n\n*Escolha a unidade:*\n\n1️⃣ Caruaru-PE\n2️⃣ Recife-PE (Madalena)\n3️⃣ Recife-PE (Home Care)`;
            }
        }
        else if (sessao.step === 5) {
            if (!cidadesDisponiveis[textoOriginal]) {
                resposta = '❌ Opção inválida. Escolha 1, 2 ou 3:';
            } else {
                sessao.dados.cidadeInfo = cidadesDisponiveis[textoOriginal];
                sessao.step = 6;
                resposta = `📍 ${sessao.dados.cidadeInfo.nome}\n\n*Escolha a especialidade:*\n\n1️⃣ Clínico Geral\n2️⃣ Cardiologia\n3️⃣ Dermatologia\n4️⃣ Pediatria`;
            }
        }
        else if (sessao.step === 6) {
            if (!especialidades[textoOriginal]) {
                resposta = '❌ Opção inválida. Escolha 1, 2, 3 ou 4:';
            } else {
                sessao.dados.especialidade = especialidades[textoOriginal];
                sessao.dados.slots = getAvailableSlots(sessao.dados.especialidade);
                sessao.step = 7;
                
                if (sessao.dados.slots.length === 0) {
                    resposta = '😓 Desculpe, não há horários disponíveis. Digite MENU para voltar.';
                    sessao.step = 0;
                } else {
                    let msgSlots = `📅 *Horários disponíveis - ${sessao.dados.especialidade}*\n\n`;
                    sessao.dados.slots.forEach((slot, idx) => {
                        msgSlots += `${idx+1}️⃣ ${slot.date} - ${slot.time}\n`;
                    });
                    msgSlots += `\nDigite o *número* do horário:`;
                    resposta = msgSlots;
                }
            }
        }
        else if (sessao.step === 7) {
            const escolha = parseInt(textoOriginal);
            if (isNaN(escolha) || escolha < 1 || escolha > sessao.dados.slots.length) {
                resposta = `❌ Opção inválida. Escolha 1 a ${sessao.dados.slots.length}:`;
            } else {
                sessao.dados.slotSelecionado = sessao.dados.slots[escolha - 1];
                sessao.step = 8;
                resposta = `📌 ${sessao.dados.slotSelecionado.date} às ${sessao.dados.slotSelecionado.time}\n\nConfirmar? Digite *SIM* ou *CANCELAR*:`;
            }
        }
        else if (sessao.step === 8) {
            if (textoLower === 'sim') {
                const novoId = await gerarIdUnico();
                const enderecoCompleto = sessao.dados.cidadeInfo.enderecoCompleto;
                const linkMapa = gerarLinkMapa(enderecoCompleto);
                
                const consulta = {
                    id: novoId,
                    date: sessao.dados.slotSelecionado.date,
                    time: sessao.dados.slotSelecionado.time,
                    specialty: sessao.dados.especialidade,
                    cidade: sessao.dados.cidadeInfo.nome,
                    enderecoCompleto: enderecoCompleto,
                    linkMapa: linkMapa,
                    status: 'AGENDADO',
                    createdAt: new Date().toISOString(),
                    paciente: {
                        nome: sessao.dados.nome,
                        cpf: formatarCPF(sessao.dados.cpf),
                        dataNascimento: sessao.dados.dataNascimento,
                        telefone: formatarTelefone(sessao.dados.telefone),
                        cpfLimpo: sessao.dados.cpf
                    }
                };
                
                await dbSet(`consultas/${novoId}`, consulta);
                await salvarPaciente(sessao.dados.cpf, sessao.dados.nome, sessao.dados.dataNascimento, sessao.dados.telefone);
                
                const dadosConfirmacao = {
                    id: novoId,
                    nome: sessao.dados.nome,
                    cpf: formatarCPF(sessao.dados.cpf),
                    dataNascimento: sessao.dados.dataNascimento,
                    cidadeInfo: sessao.dados.cidadeInfo,
                    slotSelecionado: sessao.dados.slotSelecionado,
                    especialidade: sessao.dados.especialidade,
                    linkMapa: linkMapa
                };
                
                resposta = formatarMensagemConfirmacao(dadosConfirmacao);
                
                sessao.step = 0;
                sessao.dados = {
                    nome: null, cpf: null, dataNascimento: null, telefone: null,
                    especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                    consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                    novoSlot: null, cancelamentoId: null
                };
            } 
            else if (textoLower === 'cancelar') {
                resposta = '❌ Agendamento cancelado. Digite MENU para voltar.';
                sessao.step = 0;
                sessao.dados = {
                    nome: null, cpf: null, dataNascimento: null, telefone: null,
                    especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                    consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                    novoSlot: null, cancelamentoId: null
                };
            } 
            else {
                resposta = `❌ Responda *SIM* ou *CANCELAR*:`;
            }
        }
        
        // ==========================================
        // FLUXO DE VER CONSULTAS (step 40)
        // ==========================================
        else if (sessao.step === 40) {
            const cpfLimpo = textoOriginal.replace(/[^\d]/g, '');
            if (!validarCPF(cpfLimpo)) {
                resposta = '❌ CPF inválido!';
            } else {
                const consultasUsuario = await getConsultasAtivasPorCPF(cpfLimpo);
                
                if (consultasUsuario.length === 0) {
                    resposta = `📭 Nenhuma consulta encontrada para CPF ${formatarCPF(cpfLimpo)}.\n\nDigite MENU para voltar.`;
                } else {
                    let lista = `📋 *Suas consultas*\n\n`;
                    consultasUsuario.forEach((c, idx) => {
                        lista += `${idx+1}️⃣ ${c.date} - ${c.time}\n`;
                        lista += `   ${c.specialty} | ${c.cidade}\n`;
                        lista += `   ID: ${c.id}\n\n`;
                    });
                    lista += `Digite MENU para voltar`;
                    resposta = lista;
                }
                sessao.step = 0;
            }
        }
        
        // ==========================================
        // FLUXO DE CANCELAMENTO (steps 20-22)
        // ==========================================
        else if (sessao.step === 20) {
            const cpfLimpo = textoOriginal.replace(/[^\d]/g, '');
            if (!validarCPF(cpfLimpo)) {
                resposta = '❌ CPF inválido!';
            } else {
                const consultasUsuario = await getConsultasAtivasPorCPF(cpfLimpo);
                
                if (consultasUsuario.length === 0) {
                    resposta = `📭 Nenhuma consulta encontrada.\n\nDigite MENU para voltar.`;
                    sessao.step = 0;
                } else {
                    sessao.dados.consultasParaCancelar = consultasUsuario;
                    let lista = `🗑️ *Cancelar consulta*\n\n`;
                    consultasUsuario.forEach((cons, idx) => {
                        lista += `${idx+1}️⃣ ${cons.date} - ${cons.time}\n`;
                        lista += `   ${cons.specialty}\n\n`;
                    });
                    lista += `Digite o *número* da consulta:`;
                    resposta = lista;
                    sessao.step = 21;
                }
            }
        }
        else if (sessao.step === 21) {
            const escolha = parseInt(textoOriginal);
            const consultas = sessao.dados.consultasParaCancelar;
            
            if (isNaN(escolha) || escolha < 1 || escolha > consultas.length) {
                resposta = `❌ Opção inválida. Escolha 1 a ${consultas.length}:`;
            } else {
                const consultaSelecionada = consultas[escolha - 1];
                sessao.dados.cancelamentoId = consultaSelecionada.id;
                sessao.step = 22;
                resposta = `📌 ${consultaSelecionada.date} - ${consultaSelecionada.time}\n\nConfirmar cancelamento? Digite *SIM* ou *NÃO*:`;
            }
        }
        else if (sessao.step === 22) {
            if (textoLower === 'sim') {
                const idCancelar = sessao.dados.cancelamentoId;
                const consultaData = await dbGet(`consultas/${idCancelar}`);
                
                if (consultaData) {
                    await dbSet(`cancelamentos/${idCancelar}`, {
                        ...consultaData,
                        canceladoEm: new Date().toISOString(),
                        motivo: "Cancelado via WhatsApp"
                    });
                    await dbDelete(`consultas/${idCancelar}`);
                    resposta = `✅ Consulta ${idCancelar} cancelada com sucesso!\n\nDigite MENU para voltar.`;
                } else {
                    resposta = `❌ Consulta não encontrada.`;
                }
                sessao.step = 0;
                sessao.dados = {
                    nome: null, cpf: null, dataNascimento: null, telefone: null,
                    especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                    consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                    novoSlot: null, cancelamentoId: null
                };
            } 
            else if (textoLower === 'não' || textoLower === 'nao') {
                resposta = '❌ Cancelamento não realizado.\n\nDigite MENU para voltar.';
                sessao.step = 0;
                sessao.dados = {
                    nome: null, cpf: null, dataNascimento: null, telefone: null,
                    especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                    consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                    novoSlot: null, cancelamentoId: null
                };
            } 
            else {
                resposta = '❌ Responda *SIM* ou *NÃO*:';
            }
        }
        
        // ==========================================
        // FLUXO DE REMARCAÇÃO (steps 30-33)
        // ==========================================
        else if (sessao.step === 30) {
            const cpfLimpo = textoOriginal.replace(/[^\d]/g, '');
            if (!validarCPF(cpfLimpo)) {
                resposta = '❌ CPF inválido!';
            } else {
                const consultasUsuario = await getConsultasAtivasPorCPF(cpfLimpo);
                
                if (consultasUsuario.length === 0) {
                    resposta = `📭 Nenhuma consulta encontrada.\n\nDigite MENU para voltar.`;
                    sessao.step = 0;
                } else {
                    sessao.dados.consultasParaRemarcar = consultasUsuario;
                    let lista = `🔄 *Remarcar consulta*\n\n`;
                    consultasUsuario.forEach((cons, idx) => {
                        lista += `${idx+1}️⃣ ${cons.date} - ${cons.time}\n`;
                        lista += `   ${cons.specialty}\n\n`;
                    });
                    lista += `Digite o *número* da consulta:`;
                    resposta = lista;
                    sessao.step = 31;
                }
            }
        }
        else if (sessao.step === 31) {
            const escolha = parseInt(textoOriginal);
            const consultas = sessao.dados.consultasParaRemarcar;
            
            if (isNaN(escolha) || escolha < 1 || escolha > consultas.length) {
                resposta = `❌ Opção inválida. Escolha 1 a ${consultas.length}:`;
            } else {
                sessao.dados.consultaOriginal = consultas[escolha - 1];
                sessao.dados.slots = getAvailableSlots(
                    sessao.dados.consultaOriginal.specialty, 
                    sessao.dados.consultaOriginal.date
                );
                sessao.step = 32;
                
                if (sessao.dados.slots.length === 0) {
                    resposta = '😓 Não há horários disponíveis. Digite MENU para voltar.';
                    sessao.step = 0;
                } else {
                    let msgSlots = `📅 *Novos horários disponíveis*\n\n`;
                    sessao.dados.slots.forEach((slot, idx) => {
                        msgSlots += `${idx+1}️⃣ ${slot.date} - ${slot.time}\n`;
                    });
                    msgSlots += `\nDigite o *número* do novo horário:`;
                    resposta = msgSlots;
                }
            }
        }
        else if (sessao.step === 32) {
            const escolha = parseInt(textoOriginal);
            if (isNaN(escolha) || escolha < 1 || escolha > sessao.dados.slots.length) {
                resposta = `❌ Opção inválida. Escolha 1 a ${sessao.dados.slots.length}:`;
            } else {
                sessao.dados.novoSlot = sessao.dados.slots[escolha - 1];
                sessao.step = 33;
                resposta = `📌 ${sessao.dados.novoSlot.date} - ${sessao.dados.novoSlot.time}\n\nConfirmar remarcação? Digite *SIM* ou *CANCELAR*:`;
            }
        }
        else if (sessao.step === 33) {
            if (textoLower === 'sim') {
                const consultaOriginal = sessao.dados.consultaOriginal;
                const novoSlot = sessao.dados.novoSlot;
                
                await dbSet(`cancelamentos/${consultaOriginal.id}`, {
                    ...consultaOriginal,
                    canceladoEm: new Date().toISOString(),
                    motivo: "Remarcado pelo paciente"
                });
                await dbDelete(`consultas/${consultaOriginal.id}`);
                
                const novoId = await gerarIdUnico();
                const novaConsulta = {
                    ...consultaOriginal,
                    id: novoId,
                    date: novoSlot.date,
                    time: novoSlot.time,
                    createdAt: new Date().toISOString(),
                    remarcadoDe: consultaOriginal.id
                };
                delete novaConsulta.canceladoEm;
                delete novaConsulta.motivo;
                
                await dbSet(`consultas/${novoId}`, novaConsulta);
                
                resposta = `✅ *Consulta remarcada!*\n\n📅 Nova data: ${novoSlot.date}\n⏰ Horário: ${novoSlot.time}\n🔖 Novo protocolo: ${novoId}\n\nDigite MENU para voltar.`;
                
                sessao.step = 0;
                sessao.dados = {
                    nome: null, cpf: null, dataNascimento: null, telefone: null,
                    especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                    consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                    novoSlot: null, cancelamentoId: null
                };
            } 
            else if (textoLower === 'cancelar') {
                resposta = '❌ Remarcação cancelada.\n\nDigite MENU para voltar.';
                sessao.step = 0;
                sessao.dados = {
                    nome: null, cpf: null, dataNascimento: null, telefone: null,
                    especialidade: null, cidadeInfo: null, slots: [], slotSelecionado: null,
                    consultasParaCancelar: [], consultasParaRemarcar: [], consultaOriginal: null,
                    novoSlot: null, cancelamentoId: null
                };
            } 
            else {
                resposta = '❌ Responda *SIM* ou *CANCELAR*:';
            }
        }
        
        else {
            resposta = '❌ Opção inválida. Digite MENU para voltar.';
        }
        
        twiml.message(resposta);
        console.log(`📤 Resposta enviada`);
        console.log('=== FIM ===\n');
        
    } catch (error) {
        console.error('❌ Erro:', error);
        twiml.message('❌ Erro interno. Digite MENU para reiniciar.');
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ PAD Saúde Bot rodando na porta ${PORT}`);
    console.log(`📍 Webhook: http://localhost:${PORT}/whatsapp\n`);
});