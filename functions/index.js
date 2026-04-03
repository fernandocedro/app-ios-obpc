const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}

/**
 * FUNÇÃO 1: Disparo Imediato
 * Só ignora se houver agendamento REAL (data e hora preenchidos).
 */
exports.enviarNotificacaoPush = onDocumentCreated("artifacts/{appId}/public/data/notifications/{notificationId}", async (event) => {
    if (!event.data) return null;
    const notificacao = event.data.data();

    if (notificacao.scheduleDate && notificacao.scheduleTime) {
        console.log("Notificação com agendamento detectada. O disparo imediato foi ignorado.");
        return null;
    }

    console.log("Enviando notificação imediata...");
    return dispararLogicaPush(notificacao, event.data.ref);
});

/**
 * FUNÇÃO 2: O Relógio (Cron)
 * Ajustada com formato internacional sv-SE para garantir compatibilidade total.
 */
exports.verificarAgendamentos = onSchedule("every 1 minutes", async (event) => {
    const agora = new Date();
    
    // sv-SE garante o formato YYYY-MM-DD exatamente como salvo no Firestore
    const dataAtual = agora.toLocaleDateString('sv-SE', { timeZone: "America/Sao_Paulo" }); 
    
    // pt-BR garante o formato HH:mm (24h)
    const horaAtual = agora.toLocaleTimeString('pt-BR', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false, 
        timeZone: "America/Sao_Paulo" 
    });

    const appId = 'default-app-id'; // Garanta que este ID é o mesmo das suas outras funções
    console.log(`Relógio em Salto: [${dataAtual}] [${horaAtual}]. Buscando na pasta exata...`);

    // ALTERAÇÃO AQUI: Caminho direto em vez de collectionGroup para evitar erro de busca
    const snapshot = await admin.firestore()
        .collection(`artifacts/${appId}/public/data/notifications`)
        .where('status', '==', 'pending')
        .where('scheduleDate', '==', dataAtual)
        .get();

    if (snapshot.empty) {
        console.log("Nenhuma notificação pendente encontrada para este minuto.");
        return null;
    }

    for (const doc of snapshot.docs) {
        const notificacao = doc.data();
        
        // Verifica se o horário agendado chegou ou já passou
        if (notificacao.scheduleTime <= horaAtual) {
            console.log(`Disparando agendamento: ${notificacao.title}`);
            await dispararLogicaPush(notificacao, doc.ref);
        }
    }
});

/**
 * LÓGICA CENTRAL DE FILTRAGEM E DISPARO
 */
async function dispararLogicaPush(notificacao, docRef) {
    // Mantemos o collectionGroup aqui pois os perfis estão espalhados por IDs de usuários diferentes
    const perfisSnapshot = await admin.firestore().collectionGroup("profile").get();
    const tokens = [];

    perfisSnapshot.forEach((doc) => {
        const dados = doc.data();
        let deveEnviar = false;

        if (notificacao.target === 'all') {
            deveEnviar = true;
        } 
        else if (dados.departmentRequests && Array.isArray(dados.departmentRequests)) {
            const pedido = dados.departmentRequests.find(req => req.departmentId === notificacao.target);
            // SÓ envia se estiver aprovado
            if (pedido && pedido.status === 'approved') {
                deveEnviar = true;
            }
        }

        if (deveEnviar) {
            if (dados.pushToken) tokens.push(dados.pushToken);
            if (dados.pushTokenWeb) tokens.push(dados.pushTokenWeb);
        }
    });

    // Remove duplicados
    const uniqueTokens = [...new Set(tokens.filter(t => !!t))];

    if (uniqueTokens.length === 0) {
        console.log("Nenhum token encontrado para este alvo.");
        await docRef.update({ status: 'no_targets_found' });
        return null;
    }

    const payload = {
        notification: {
            title: notificacao.title,
            body: notificacao.body,
        },
        android: {
            priority: "high"
        }
    };

    try {
        const response = await admin.messaging().sendEachForMulticast({
            ...payload,
            tokens: uniqueTokens
        });
        
        console.log(`Sucesso: ${response.successCount} mensagens enviadas.`);
        
        // Atualiza para 'sent' para o relógio não processar novamente
        await docRef.update({ 
            status: 'sent', 
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            successCount: response.successCount 
        });

    } catch (error) {
        console.error("Erro ao processar envio de push:", error);
        await docRef.update({ status: 'failed', error: error.message });
    }
}
/**
 * LÓGICA CENTRAL DE FILTRAGEM E DISPARO
 */
async function dispararLogicaPush(notificacao, docRef) {
    const perfisSnapshot = await admin.firestore().collectionGroup("profile").get();
    const tokens = [];

    perfisSnapshot.forEach((doc) => {
        const dados = doc.data();
        let deveEnviar = false;

        if (notificacao.target === 'all') {
            deveEnviar = true;
        } 
        else if (dados.departmentRequests && Array.isArray(dados.departmentRequests)) {
            const pedido = dados.departmentRequests.find(req => req.departmentId === notificacao.target);
            if (pedido && pedido.status === 'approved') {
                deveEnviar = true;
            }
        }

        if (deveEnviar) {
            if (dados.pushToken) tokens.push(dados.pushToken);
            if (dados.pushTokenWeb) tokens.push(dados.pushTokenWeb);
        }
    });

    const uniqueTokens = [...new Set(tokens.filter(t => !!t))];

    if (uniqueTokens.length === 0) {
        console.log("Nenhum token encontrado para este alvo.");
        await docRef.update({ status: 'no_targets_found' });
        return null;
    }

    const payload = {
        notification: {
            title: notificacao.title,
            body: notificacao.body,
        },
        android: {
            priority: "high"
        }
    };

    try {
        const response = await admin.messaging().sendEachForMulticast({
            ...payload,
            tokens: uniqueTokens
        });
        
        console.log(`Sucesso: ${response.successCount} mensagens enviadas.`);
        
        await docRef.update({ 
            status: 'sent', 
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            successCount: response.successCount 
        });

    } catch (error) {
        console.error("Erro ao processar envio de push:", error);
        await docRef.update({ status: 'failed', error: error.message });
    }
}