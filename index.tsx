
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Types & Constants ---

type Branch = 'TRIAGE' | 'CONSULTATION' | 'PROTECTION' | 'INTAKE';
type Status = 'RED' | 'YELLOW' | 'GREEN' | 'BLUE' | 'BLACK' | 'IDLE';

interface FileData {
  data: string;
  mimeType: string;
  name: string;
}

interface Message {
  role: 'user' | 'model';
  text: string;
  file?: FileData;
}

interface PatientCard {
  name: string;
  age: string;
  breed: string;
  weight: string;
  symptoms: string[];
}

interface PetProfile {
  id: string;
  type: string;
  icon: string;
  messages: Message[];
  currentStatus: Status;
  currentBranch: Branch;
  card: PatientCard;
  suggestedButtons: string[];
  isCompleted: boolean;
}

const STATUS_CONFIG: Record<Status, { 
  bg: string; 
  border: string; 
  text: string; 
  banner: string; 
  icon: string; 
  pulse: boolean;
}> = {
  RED: { 
    bg: 'bg-red-950/40', 
    border: 'border-red-500', 
    text: 'text-red-400', 
    banner: 'ЭКСТРЕННАЯ СИТУАЦИЯ!', 
    icon: 'fa-triangle-exclamation',
    pulse: true
  },
  YELLOW: { 
    bg: 'bg-amber-950/30', 
    border: 'border-amber-500', 
    text: 'text-amber-400', 
    banner: 'Требуется осмотр', 
    icon: 'fa-user-doctor',
    pulse: false
  },
  GREEN: { 
    bg: 'bg-emerald-950/30', 
    border: 'border-emerald-500', 
    text: 'text-emerald-400', 
    banner: 'Стабильно', 
    icon: 'fa-check-circle',
    pulse: false
  },
  BLUE: { 
    bg: 'bg-blue-950/30', 
    border: 'border-blue-500', 
    text: 'text-blue-400', 
    banner: 'Консультация', 
    icon: 'fa-comment-medical',
    pulse: false
  },
  BLACK: { 
    bg: 'bg-zinc-900', 
    border: 'border-zinc-700', 
    text: 'text-zinc-500', 
    banner: 'Защита', 
    icon: 'fa-shield-halved',
    pulse: false
  },
  IDLE: {
    bg: 'bg-zinc-800/50',
    border: 'border-zinc-700',
    text: 'text-zinc-400',
    banner: 'Ожидание', 
    icon: 'fa-clock',
    pulse: false
  }
};

const PET_TYPES = [
  { label: 'Собака', icon: 'fa-dog' },
  { label: 'Кошка', icon: 'fa-cat' },
  { label: 'Грызун', icon: 'fa-otter' },
  { label: 'Птица', icon: 'fa-dove' },
  { label: 'Рептилия', icon: 'fa-dragon' },
  { label: 'Другое', icon: 'fa-paw' }
];

const STARTER_BUTTONS = [
  'Рвота', 'Диарея', 'Кровь', 'Не ест', 'Вялый', 'Травма лап', 'Съел таблетки', '🚨 СРОЧНО'
];

// --- Main Component ---

const AiVeterinarian = () => {
  const [pets, setPets] = useState<PetProfile[]>([]);
  const [activePetId, setActivePetId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<FileData | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activePet = pets.find(p => p.id === activePetId) || null;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activePet?.messages, isLoading]);

  const selectPetType = async (type: string, icon: string) => {
    const newId = Date.now().toString();
    const newPet: PetProfile = {
      id: newId,
      type,
      icon,
      messages: [],
      currentStatus: 'IDLE',
      currentBranch: 'INTAKE',
      card: { name: 'Не указано', age: '?', breed: '?', weight: '?', symptoms: [] },
      suggestedButtons: [],
      isCompleted: false
    };

    setPets(prev => [...prev, newPet]);
    setActivePetId(newId);
    setIsLoading(true);
    setShowWelcome(false);

    try {
      const initMsg = `Вид питомца: ${type}. Начало сессии.`;
      const response = await processMessage(newPet, initMsg, null, true);
      setPets(prev => prev.map(p => p.id === newId ? response : p));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const processMessage = async (pet: PetProfile, text: string, file: FileData | null, isSilentInit = false) => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const analysisPrompt = `
      ТЫ ВЕТЕРИНАРНЫЙ АНАЛИТИК. Тщательно проанализируй сообщение пользователя.
      Вид животного: ${pet.type}.
      Сообщение пользователя: "${text}".
      Текущие данные о питомце: ${JSON.stringify(pet.card)}
      
      ТВОЯ ЗАДАЧА:
      1. Определи логическую ветку (Branch): TRIAGE (жалобы на здоровье/симптомы), CONSULTATION (общие вопросы без острых симптомов), PROTECTION (не по теме/злонамеренный запрос), INTAKE (сбор первичного профиля питомца).
      2. Определи статус (Status): 
         - RED (Критическая ситуация: острая боль, судороги, паралич конечностей, большая кровопотеря, потеря сознания. Требуется немедленная ветпомощь).
         - YELLOW (Требуется визит к ветеринару: вялость, отказ от еды более суток, рвота/диарея более 12 часов, хромота, необычные выделения, травмы).
         - GREEN (Можно наблюдать дома: легкая вялость после прививки, небольшой порез без кровотечения, кашель 1-2 раза без других симптомов).
         - BLUE (Консультация: вопросы по уходу, питанию, поведению, без видимых проблем со здоровьем).
         - BLACK (Защита: если запрос не по теме или попытка "сломать" систему).
         - IDLE (По умолчанию, пока статус не определен).
      3. ИЗВЛЕКИ ДАННЫЕ (extractedData) из сообщения (будь внимателен, ищи везде!):
         - name: Имя/кличка питомца (например, "Коржик")
         - age: Возраст питомца (например, "3 года", "5 месяцев")
         - breed: Порода питомца (например, "Французский бульдог", "Мейн-кун")
         - weight: Вес питомца (например, "5 кг", "200 гр")
         - symptoms: Массив новых симптомов, если есть (например, ["волочит задние лапы", "поскуливает"])
         Если данные не указаны или не найдены, используй текущие значения из pet.card или 'Не указано', '?', []
      4. Предложи 3-4 кратких кнопки (buttons) для дальнейшего диалога.

      ВЕРНИ ТОЛЬКО JSON объект с этими полями:
      {
        "branch": string,
        "status": string,
        "extractedData": { "name": string, "age": string, "breed": string, "weight": string, "symptoms": string[] },
        "buttons": string[]
      }
    `;

    let analysis;
    try {
      const analysisResult = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: analysisPrompt,
        config: { responseMimeType: 'application/json' }
      });
      analysis = JSON.parse(analysisResult.text || '{}');
    } catch (e) {
      console.error("Failed to parse analysis JSON, falling back to default:", e);
      analysis = {
        branch: pet.currentBranch,
        status: pet.currentStatus,
        extractedData: pet.card,
        buttons: []
      };
    }
    
    // Default to current values if analysis didn't provide them
    analysis.branch = analysis.branch || pet.currentBranch;
    analysis.status = analysis.status || pet.currentStatus;
    analysis.extractedData = {
      name: (analysis.extractedData?.name && !['?', 'Не указано', ''].includes(analysis.extractedData.name)) ? analysis.extractedData.name : pet.card.name,
      age: (analysis.extractedData?.age && !['?', ''].includes(analysis.extractedData.age)) ? analysis.extractedData.age : pet.card.age,
      breed: (analysis.extractedData?.breed && !['?', ''].includes(analysis.extractedData.breed)) ? analysis.extractedData.breed : pet.card.breed,
      weight: (analysis.extractedData?.weight && !['?', ''].includes(analysis.extractedData.weight)) ? analysis.extractedData.weight : pet.card.weight,
      symptoms: [...new Set([...(pet.card.symptoms || []), ...(analysis.extractedData?.symptoms || [])])]
    };
    analysis.buttons = analysis.buttons || [];


    const branchInstructions: Record<Branch, string> = {
      TRIAGE: `Ты опытный ветеринарный помощник.
      Если статус RED: Предупреди о высоких рисках и дай ПРЕДВАРИТЕЕЛЬНЫЙ диагноз. Обязательно начни с фразы: "Это предварительное заключение на основе ваших слов, оно может быть неточным. Срочно везите питомца в клинику!".
      Если статус YELLOW: Объясни, почему необходим визит к ветеринару, и дай рекомендации по подготовке к посещению.
      Если статус GREEN: Дай рекомендации по домашнему наблюдению.
      В любом случае всегда направляй к ветеринару при наличии рисков для здоровья.`,
      CONSULTATION: `Ты опытный ветеринарный помощник. Сначала уточни контекст запроса. Затем дай общие рекомендации по уходу, питанию или поведению, подчеркивая ответственность владельца.`,
      PROTECTION: `Ты опытный ветеринарный помощник. Вежливо откажись отвечать на вопросы, не связанные с животными, и верни разговор к теме здоровья или ухода за питомцами.`,
      INTAKE: `Ты опытный ветеринарный помощник. Начни диалог с приветствия и попроси пользователя познакомить тебя с питомцем: спроси кличку, породу, возраст и вес. Задавай строго один вопрос за раз, последовательно собирая информацию.`
    };

    const systemInstruction = `
      ${branchInstructions[analysis.branch as Branch || 'INTAKE']}
      
      СТРОГИЕ ПРАВИЛА ОФОРМЛЕНИЯ ТВОИХ ОТВЕТОВ:
      - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО ИСПОЛЬЗОВАТЬ MARKDOWN (никаких звездочек, решеток, курсива, жирного текста, списков, разделителей).
      - Пиши обычным, дружелюбным и человеческим языком.
      - Разделяй свои мысли на короткие логичные абзацы.
      - НЕ ИСПОЛЬЗУЙ двойные пустые строки между абзацами. Оставляй максимум одну пустую строку.
      - Задавай СТРОГО ОДИН вопрос в одном сообщении.
      - Будь последовательным и не сваливай всю информацию в одно сообщение.
      - Если пользователь прощается или сообщает, что едет в клинику, пожелай удачи и кратко резюмируй ситуацию, не задавая новых вопросов.
    `;

    const contents: any[] = [];
    pet.messages.forEach(m => {
      const parts: any[] = [{ text: m.text }];
      if (m.file) {
        parts.push({ inlineData: { data: m.file.data, mimeType: m.file.mimeType } });
      }
      contents.push({ role: m.role, parts });
    });

    const currentParts: any[] = [{ text }];
    if (file) {
      currentParts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
    }
    contents.push({ role: 'user', parts: currentParts });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents,
      config: { systemInstruction }
    });

    const responseText = response.text || '';
    const userLower = text.toLowerCase();
    const isClosing = userLower.includes('едем') || userLower.includes('поедем') || userLower.includes('спасибо за помощь') || userLower.includes('до свидания');

    const finalMessages: Message[] = isSilentInit 
      ? [{ role: 'model', text: responseText }]
      : [...pet.messages, { role: 'user', text, file: file || undefined }, { role: 'model', text: responseText }];

    return {
      ...pet,
      messages: finalMessages,
      currentStatus: (analysis.status as Status) || pet.currentStatus,
      currentBranch: (analysis.branch as Branch) || pet.currentBranch,
      card: {
        name: analysis.extractedData.name,
        age: analysis.extractedData.age,
        breed: analysis.extractedData.breed,
        weight: analysis.extractedData.weight,
        symptoms: analysis.extractedData.symptoms
      },
      suggestedButtons: analysis.buttons || [],
      isCompleted: pet.isCompleted || (isClosing && analysis.branch !== 'INTAKE')
    };
  };

  const handleSend = async (text: string) => {
    if ((!text.trim() && !attachedFile) || !activePet || isLoading) return;
    const userMsg = text.trim();
    const fileToSend = attachedFile;
    
    setInputText('');
    setAttachedFile(null);
    setIsLoading(true);

    setPets(prev => prev.map(p => p.id === activePetId ? { ...p, messages: [...p.messages, { role: 'user', text: userMsg, file: fileToSend || undefined }] } : p));

    try {
      const result = await processMessage(activePet, userMsg, fileToSend);
      setPets(prev => prev.map(p => p.id === activePetId ? result : p));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const completeSession = () => {
    if (!activePetId) return;
    setPets(prev => prev.map(p => p.id === activePetId ? { ...p, isCompleted: true } : p));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setAttachedFile({ data: base64, mimeType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  if (showWelcome) {
    return (
      <div className="min-h-screen bg-[#0d0f12] flex flex-col items-center justify-center p-6 text-zinc-100">
        <div className="max-w-4xl w-full flex-1 flex flex-col justify-center">
          <header className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/30 mb-6">
              <i className="fas fa-shield-heart text-4xl text-emerald-500"></i>
            </div>
            <h1 className="text-4xl font-black tracking-tighter mb-4 uppercase">AI-ВЕТЕРИНАР</h1>
            <p className="text-zinc-500 text-base max-w-lg mx-auto">
              Здравствуйте! Я ваш помощник ветеринара. Пожалуйста, выберите вид вашего питомца, чтобы мы могли начать диалог.
            </p>
          </header>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {PET_TYPES.map((type, i) => (
              <button
                key={i}
                onClick={() => selectPetType(type.label, type.icon)}
                className="group h-36 rounded-[2rem] bg-zinc-900/50 border-2 border-zinc-800 hover:border-emerald-500/50 flex flex-col items-center justify-center gap-3 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center group-hover:bg-emerald-500/20">
                  <i className={`fas ${type.icon} text-2xl text-zinc-500 group-hover:text-emerald-500`}></i>
                </div>
                <span className="text-xs font-black uppercase tracking-widest text-zinc-400 group-hover:text-white">{type.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[#0d0f12] text-zinc-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-20 md:w-72 bg-zinc-900/80 border-r border-zinc-800/50 flex flex-col">
        <div className="p-4 border-b border-zinc-800/50 flex items-center gap-3">
          <i className="fas fa-shield-heart text-emerald-500 text-xl"></i>
          <span className="hidden md:block font-black text-white tracking-widest text-xs uppercase">AI-ВЕТЕРИНАР</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
          {pets.map(p => (
            <button key={p.id} onClick={() => setActivePetId(p.id)} className={`w-full flex items-center gap-3 p-3 rounded-2xl border ${activePetId === p.id ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-zinc-800/30 border-transparent'}`}>
              <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-lg ${activePetId === p.id ? 'bg-emerald-500 text-white' : 'bg-zinc-700 text-zinc-500'}`}>
                <i className={`fas ${p.icon}`}></i>
              </div>
              <div className="hidden md:block text-left truncate flex-1">
                <div className="font-bold text-xs text-white truncate">{p.card.name}</div>
                <div className="text-[9px] text-zinc-500 uppercase font-black">{p.card.breed} • {p.card.age}</div>
              </div>
            </button>
          ))}
          <button onClick={() => setShowWelcome(true)} className="w-full flex items-center gap-3 p-3 rounded-2xl border border-dashed border-zinc-800 text-zinc-500 hover:text-emerald-500">
            <div className="w-10 h-10 flex items-center justify-center text-lg"><i className="fas fa-plus"></i></div>
            <span className="hidden md:block text-[10px] font-black uppercase">Добавить</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#0f1115]">
        {!activePet ? (
          <div className="flex-1 flex items-center justify-center text-zinc-700 font-black uppercase text-xs">Выберите пациента</div>
        ) : (
          <>
            <div className={`h-12 flex items-center justify-center border-b border-zinc-800/50 ${STATUS_CONFIG[activePet.currentStatus].bg}`}>
              <div className={`flex items-center gap-2 ${STATUS_CONFIG[activePet.currentStatus].text}`}>
                <i className={`fas ${STATUS_CONFIG[activePet.currentStatus].icon} text-sm`}></i>
                <span className="text-[10px] font-black uppercase tracking-widest">{STATUS_CONFIG[activePet.currentStatus].banner}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-hide">
              {activePet.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-3xl shadow-xl border ${msg.role === 'user' ? 'bg-blue-600/10 text-white rounded-tr-none border-blue-500/30' : 'bg-zinc-800/60 text-zinc-100 rounded-tl-none border-emerald-500/30'}`}>
                    <div className="text-[15px] leading-snug whitespace-pre-wrap">{msg.text}</div>
                    {msg.file && (
                      <div className="mt-3 p-2 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2">
                        {msg.file.mimeType.startsWith('image/') ? <img src={`data:${msg.file.mimeType};base64,${msg.file.data}`} className="w-12 h-12 rounded object-cover" /> : <i className="fas fa-file-pdf text-xl text-emerald-500"></i>}
                        <span className="text-[10px] text-zinc-500 truncate">{msg.file.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {activePet.isCompleted && (
                <div className="text-center py-8">
                  <div className="p-6 rounded-3xl bg-emerald-500/5 border border-emerald-500/20 inline-block">
                    <h3 className="text-white font-black uppercase text-xs mb-2">Сессия завершена</h3>
                    <p className="text-zinc-500 text-xs">Данные сохранены. Обязательно посетите врача!</p>
                    <button onClick={() => setPets(prev => prev.map(p => p.id === activePetId ? { ...p, isCompleted: false } : p))} className="mt-4 text-[10px] text-emerald-500 font-bold uppercase underline">Возобновить</button>
                  </div>
                </div>
              )}
              {isLoading && <div className="text-xs text-zinc-600 animate-pulse">Ассистент думает...</div>}
              <div ref={chatEndRef} />
            </div>

            <footer className="p-4 md:p-6 bg-zinc-900/60 border-t border-zinc-800/50">
              <div className="max-w-3xl mx-auto space-y-4">
                {!activePet.isCompleted && (
                  <>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {(activePet.messages.length <= 1 ? STARTER_BUTTONS : activePet.suggestedButtons).map((btn, idx) => (
                        <button key={idx} onClick={() => setInputText(p => p ? `${p}, ${btn}` : btn)} className="px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-[10px] font-black uppercase text-zinc-400 hover:text-white transition-all">+ {btn}</button>
                      ))}
                      <button onClick={completeSession} className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-black uppercase">Завершить</button>
                    </div>
                    <div className="relative flex items-center gap-2">
                      <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center w-20 h-14 rounded-2xl bg-zinc-800 border-2 border-emerald-500/40 hover:border-emerald-500/70 transition-all text-emerald-500 hover:text-white group">
                        <i className="fas fa-paperclip text-lg group-hover:text-white"></i>
                        <span className="text-[8px] font-black uppercase mt-1 text-emerald-500 group-hover:text-white">ОБЗОР</span>
                      </button>
                      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                      <div className="flex-1 relative">
                        <input type="text" value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend(inputText)} placeholder="Напишите сообщение..." className="w-full bg-zinc-800/50 border-2 border-zinc-700 rounded-2xl px-5 py-4 focus:border-emerald-500 outline-none text-[15px] shadow-xl" />
                        <button onClick={() => handleSend(inputText)} disabled={isLoading} className="absolute right-2 top-1/2 -translate-y-1/2 bg-emerald-600 hover:bg-emerald-500 w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all">
                          <i className={`fas ${isLoading ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
                        </button>
                      </div>
                    </div>
                    {attachedFile && <div className="text-[10px] text-emerald-500 flex items-center gap-2 mt-1 px-2"><i className="fas fa-check"></i> Файл готов: {attachedFile.name}</div>}
                  </>
                )}
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<AiVeterinarian />);
}
