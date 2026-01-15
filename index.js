/**
 * Universal Nano Banana Image Generator 🍌
 * Universal image generation with avatar face reference for Nano Banana Pro
 * Works with any intermediate service providing Nano Banana Pro access
 * Version 1.0.0
 */

import { 
    saveSettingsDebounced, 
    getRequestHeaders, 
    appendMediaToMessage, 
    eventSource, 
    event_types, 
    saveChatConditional,
    getContext,
    extension_settings,
    name1,
} from '../../../../script.js';

import { getBase64Async, saveBase64AsFile } from '../../../utils.js';
import { MEDIA_DISPLAY, MEDIA_SOURCE, MEDIA_TYPE, SCROLL_BEHAVIOR } from '../../../constants.js';

const extensionName = 'universal-nano-banana';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    // Универсальные настройки
    serviceType: 'custom', // custom, replicate, openai, stability
    endpointUrl: 'https://your-service.com/nano-banana/generate',
    apiKey: '',
    
    // Настройки Nano Banana
    useAvatarReference: true,
    faceReferenceStrength: 0.85,
    useCharacterContext: false,
    messageContextDepth: 2,
    
    // Параметры генерации
    model: 'nano-banana-pro',
    quality: 'premium',
    style: 'realistic',
    negativePrompt: 'low quality, blurry, deformed',
    width: 1024,
    height: 1024,
    guidanceScale: 7.5,
    seed: -1,
    
    // Системные инструкции
    systemPrompt: 'You are Nano Banana Pro image generator. Generate high-quality images based on the prompt and reference images. When character avatar is provided, use it as exact facial reference maintaining all facial features, eye color, skin tone, and unique characteristics.',
    
    // Формат запроса
    requestFormat: 'multipart', // multipart или json
    avatarFieldName: 'reference_image',
    promptFieldName: 'prompt',
    
    // История
    lastGenerated: null,
};

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }

    // Загрузка значений в UI
    $('#nano_service_type').val(extension_settings[extensionName].serviceType);
    $('#nano_endpoint_url').val(extension_settings[extensionName].endpointUrl);
    $('#nano_api_key').val(extension_settings[extensionName].apiKey);
    $('#nano_use_avatar').prop('checked', extension_settings[extensionName].useAvatarReference);
    $('#nano_face_strength').val(extension_settings[extensionName].faceReferenceStrength);
    $('#nano_use_context').prop('checked', extension_settings[extensionName].useCharacterContext);
    $('#nano_context_depth').val(extension_settings[extensionName].messageContextDepth);
    $('#nano_model').val(extension_settings[extensionName].model);
    $('#nano_quality').val(extension_settings[extensionName].quality);
    $('#nano_style').val(extension_settings[extensionName].style);
    $('#nano_negative_prompt').val(extension_settings[extensionName].negativePrompt);
    $('#nano_width').val(extension_settings[extensionName].width);
    $('#nano_height').val(extension_settings[extensionName].height);
    $('#nano_guidance_scale').val(extension_settings[extensionName].guidanceScale);
    $('#nano_seed').val(extension_settings[extensionName].seed);
    $('#nano_system_prompt').val(extension_settings[extensionName].systemPrompt);
    $('#nano_request_format').val(extension_settings[extensionName].requestFormat);
    $('#nano_avatar_field').val(extension_settings[extensionName].avatarFieldName);
    $('#nano_prompt_field').val(extension_settings[extensionName].promptFieldName);

    updateServiceTypeUI();
    updateStrengthValue();
}

async function getCharacterAvatar() {
    const context = getContext();
    const character = context.characters[context.characterId];
    
    if (!character?.avatar) {
        console.warn(`[${extensionName}] No character avatar found`);
        return null;
    }

    try {
        const avatarUrl = `/characters/${encodeURIComponent(character.avatar)}`;
        console.log(`[${extensionName}] Fetching avatar from:`, avatarUrl);
        
        const response = await fetch(avatarUrl);
        
        if (!response.ok) {
            console.warn(`[${extensionName}] Failed to fetch avatar: ${response.status}`);
            return null;
        }

        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        const parts = base64.split(',');
        const mimeType = parts[0]?.match(/data:([^;]+)/)?.[1] || 'image/png';
        const imageData = parts[1] || base64;

        return {
            mimeType: mimeType,
            data: imageData,
            name: context.name2 || 'Character',
            filename: character.avatar,
            blob: blob
        };
    } catch (error) {
        console.error(`[${extensionName}] Error fetching character avatar:`, error);
        return null;
    }
}

function getRecentContext(depth) {
    const settings = extension_settings[extensionName];
    if (!settings.useCharacterContext) return '';
    
    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return '';
    
    const messages = [];
    const startIndex = Math.max(chat.length - depth, 0);
    
    for (let i = startIndex; i < chat.length; i++) {
        const message = chat[i];
        if (message.mes && !message.is_system) {
            const sender = message.is_user ? (name1 || 'User') : (context.name2 || 'Character');
            messages.push(`[${sender}]: ${message.mes}`);
        }
    }
    
    if (messages.length > 0) {
        return `Context from recent conversation:\n${messages.join('\n')}\n\n`;
    }
    
    return '';
}

function buildEnhancedPrompt(userPrompt) {
    const settings = extension_settings[extensionName];
    const context = getContext();
    
    let prompt = userPrompt;
    
    // Добавляем контекст разговора
    const recentContext = getRecentContext(settings.messageContextDepth);
    if (recentContext) {
        prompt = `${recentContext}Based on above context, generate: ${prompt}`;
    }
    
    // Добавляем стиль
    if (settings.style && settings.style !== 'none') {
        prompt = `${prompt}, ${settings.style} style`;
    }
    
    // Добавляем качество
    if (settings.quality === 'premium') {
        prompt = `${prompt}, masterpiece, best quality, ultra detailed`;
    } else if (settings.quality === 'standard') {
        prompt = `${prompt}, high quality, detailed`;
    }
    
    // Добавляем инструкции для лица, если используется аватар
    if (settings.useAvatarReference) {
        prompt = `${prompt}, exact facial features, precise face structure, identical facial characteristics, maintain eye color and skin tone`;
    }
    
    return prompt.trim();
}

async function sendMultipartRequest(endpoint, formData, headers) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: formData,
    });
    
    return response;
}

async function sendJsonRequest(endpoint, jsonData, headers) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: JSON.stringify(jsonData),
    });
    
    return response;
}

async function generateWithNanoBanana(userPrompt) {
    const settings = extension_settings[extensionName];
    
    if (!settings.endpointUrl || !settings.endpointUrl.startsWith('http')) {
        throw new Error('Please configure a valid endpoint URL in settings');
    }

    // Получаем аватар
    const avatarData = settings.useAvatarReference ? await getCharacterAvatar() : null;
    
    if (settings.useAvatarReference && !avatarData) {
        throw new Error('Character avatar not found. Please set a character avatar in character settings.');
    }

    // Строим улучшенный промпт
    const enhancedPrompt = buildEnhancedPrompt(userPrompt);
    console.log(`[${extensionName}] Enhanced prompt:`, enhancedPrompt);

    // Подготавливаем заголовки
    const headers = {};
    
    if (settings.apiKey) {
        // Автоматически определяем тип авторизации
        if (settings.endpointUrl.includes('openai') || settings.endpointUrl.includes('api.openai.com')) {
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
        } else if (settings.endpointUrl.includes('replicate.com')) {
            headers['Authorization'] = `Token ${settings.apiKey}`;
        } else if (settings.endpointUrl.includes('stability.ai')) {
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
            headers['Accept'] = 'image/png';
        } else {
            // Универсальные заголовки
            headers['X-API-Key'] = settings.apiKey;
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
            headers['api-key'] = settings.apiKey;
        }
    }

    // Добавляем дополнительные заголовки из системных
    const systemHeaders = getRequestHeaders();
    Object.assign(headers, systemHeaders);

    let response;
    
    if (settings.requestFormat === 'multipart') {
        // Multipart/form-data запрос
        const formData = new FormData();
        
        // Добавляем промпт
        formData.append(settings.promptFieldName || 'prompt', enhancedPrompt);
        
        // Добавляем аватар если есть
        if (avatarData && settings.useAvatarReference) {
            const blob = avatarData.blob;
            const fileName = avatarData.filename || 'avatar.png';
            formData.append(settings.avatarFieldName || 'reference_image', blob, fileName);
            
            // Добавляем параметры для лица
            formData.append('face_strength', settings.faceReferenceStrength.toString());
            formData.append('preserve_facial_features', 'true');
        }
        
        // Добавляем другие параметры
        formData.append('model', settings.model);
        formData.append('negative_prompt', settings.negativePrompt);
        formData.append('width', settings.width.toString());
        formData.append('height', settings.height.toString());
        formData.append('guidance_scale', settings.guidanceScale.toString());
        formData.append('seed', settings.seed === -1 ? Math.floor(Math.random() * 1000000).toString() : settings.seed.toString());
        formData.append('quality', settings.quality);
        
        // Системные инструкции
        if (settings.systemPrompt) {
            formData.append('system_instruction', settings.systemPrompt);
        }
        
        console.log(`[${extensionName}] Sending multipart request to:`, settings.endpointUrl);
        response = await sendMultipartRequest(settings.endpointUrl, formData, headers);
        
    } else {
        // JSON запрос
        const payload = {
            [settings.promptFieldName || 'prompt']: enhancedPrompt,
            model: settings.model,
            negative_prompt: settings.negativePrompt,
            width: parseInt(settings.width),
            height: parseInt(settings.height),
            guidance_scale: parseFloat(settings.guidanceScale),
            seed: settings.seed === -1 ? Math.floor(Math.random() * 1000000) : parseInt(settings.seed),
            quality: settings.quality,
            style: settings.style,
        };
        
        // Добавляем аватар если есть
        if (avatarData && settings.useAvatarReference) {
            payload[settings.avatarFieldName || 'reference_image'] = `data:${avatarData.mimeType};base64,${avatarData.data}`;
            payload.face_strength = parseFloat(settings.faceReferenceStrength);
            payload.preserve_facial_features = true;
            payload.reference_mode = 'exact_face';
        }
        
        // Системные инструкции
        if (settings.systemPrompt) {
            payload.system_instruction = settings.systemPrompt;
        }
        
        console.log(`[${extensionName}] Sending JSON request to:`, settings.endpointUrl);
        console.log(`[${extensionName}] Payload keys:`, Object.keys(payload));
        response = await sendJsonRequest(settings.endpointUrl, payload, headers);
    }

    // Обработка ответа
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${extensionName}] API Error:`, response.status, errorText);
        
        let errorMessage = `Service error: ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorJson.detail || errorJson.message || errorMessage;
        } catch (e) {}
        
        throw new Error(errorMessage);
    }

    // Извлечение изображения из ответа
    const contentType = response.headers.get('content-type') || '';
    let imageData;
    
    if (contentType.includes('application/json')) {
        const result = await response.json();
        
        // Пробуем разные форматы ответов
        if (result.image) {
            imageData = result.image.replace(/^data:image\/\w+;base64,/, '');
        } else if (result.data && result.data[0] && result.data[0].url) {
            // OpenAI/DALL-E формат
            const imageUrl = result.data[0].url;
            const imageResponse = await fetch(imageUrl);
            const blob = await imageResponse.blob();
            imageData = await getBase64Async(blob);
            imageData = imageData.replace(/^data:image\/\w+;base64,/, '');
        } else if (result.output && Array.isArray(result.output)) {
            // Replicate формат
            const imageUrl = result.output[0];
            const imageResponse = await fetch(imageUrl);
            const blob = await imageResponse.blob();
            imageData = await getBase64Async(blob);
            imageData = imageData.replace(/^data:image\/\w+;base64,/, '');
        } else if (result.artifacts && Array.isArray(result.artifacts)) {
            // Stability AI формат
            imageData = result.artifacts[0].base64;
        } else {
            // Пробуем найти любое поле с base64
            for (const key in result) {
                if (typeof result[key] === 'string' && result[key].startsWith('data:image/')) {
                    imageData = result[key].replace(/^data:image\/\w+;base64,/, '');
                    break;
                }
            }
            
            if (!imageData) {
                throw new Error('Could not find image data in JSON response');
            }
        }
    } else if (contentType.includes('image/')) {
        // Прямой ответ с изображением
        const blob = await response.blob();
        const base64 = await getBase64Async(blob);
        imageData = base64.replace(/^data:image\/\w+;base64,/, '');
    } else {
        // Пробуем как base64 строку
        const text = await response.text();
        if (text.startsWith('data:image/')) {
            imageData = text.replace(/^data:image\/\w+;base64,/, '');
        } else {
            // Пробуем как чистый base64
            try {
                // Проверяем, является ли строка валидным base64
                atob(text);
                imageData = text;
            } catch {
                throw new Error(`Unsupported response format: ${contentType}`);
            }
        }
    }

    // Сохраняем информацию о последней генерации
    settings.lastGenerated = {
        timestamp: Date.now(),
        prompt: userPrompt,
        withAvatar: !!avatarData,
        imageSize: imageData.length
    };
    saveSettingsDebounced();

    return {
        imageData: imageData,
        mimeType: 'image/png',
        prompt: enhancedPrompt,
        withAvatar: !!avatarData
    };
}

async function nanoMessageButton($icon) {
    const context = getContext();
    
    if ($icon.hasClass('nano_busy')) {
        console.log('[Nano] Already generating...');
        return;
    }

    const messageElement = $icon.closest('.mes');
    const messageId = Number(messageElement.attr('mesid'));
    const message = context.chat[messageId];

    if (!message) {
        console.error('[Nano] Could not find message for generation button');
        return;
    }

    const prompt = message.mes;
    if (!prompt) {
        toastr.warning('No message content to generate from.', 'Nano Banana Pro');
        return;
    }

    $icon.addClass('nano_busy');
    $icon.removeClass('fa-bolt').addClass('fa-spinner fa-spin');

    try {
        const result = await generateWithNanoBanana(prompt);

        if (result) {
            // Сохраняем изображение в файл
            const fileName = `nano_${Date.now()}`;
            const filePath = await saveBase64AsFile(result.imageData, extensionName, fileName, 'png');
            console.log(`[${extensionName}] Image saved to:`, filePath);

            if (!message.extra || typeof message.extra !== 'object') {
                message.extra = {};
            }

            if (!Array.isArray(message.extra.media)) {
                message.extra.media = [];
            }

            if (!message.extra.media_display) {
                message.extra.media_display = MEDIA_DISPLAY.GALLERY;
            }

            const mediaAttachment = {
                url: filePath,
                type: MEDIA_TYPE.IMAGE,
                title: `Nano: ${prompt.substring(0, 80)}`,
                source: MEDIA_SOURCE.GENERATED,
                generatedWith: result.withAvatar ? 'Avatar reference' : 'No reference'
            };

            message.extra.media.push(mediaAttachment);
            message.extra.media_index = message.extra.media.length - 1;
            message.extra.inline_image = true;

            appendMediaToMessage(message, messageElement, SCROLL_BEHAVIOR.KEEP);
            await saveChatConditional();
            
            toastr.success(`Image generated${result.withAvatar ? ' with avatar reference' : ''}!`, 'Nano Banana Pro');
        }

    } catch (error) {
        console.error(`[${extensionName}] Generation error:`, error);
        toastr.error(`Failed to generate: ${error.message}`, 'Nano Banana Pro');
    } finally {
        $icon.removeClass('nano_busy fa-spinner fa-spin').addClass('fa-bolt');
    }
}

async function quickGenerate() {
    const prompt = $('#nano_quick_prompt').val().trim();
    
    if (!prompt) {
        toastr.warning('Please enter a prompt first.', 'Nano Banana Pro');
        return;
    }

    const generateBtn = $('#nano_quick_generate');
    generateBtn.addClass('generating');
    generateBtn.find('i').removeClass('fa-bolt').addClass('fa-spinner fa-spin');

    try {
        const result = await generateWithNanoBanana(prompt);
        
        if (result) {
            const imageDataUrl = `data:image/png;base64,${result.imageData}`;
            $('#nano_preview_image').attr('src', imageDataUrl);
            $('#nano_preview_container').show();
            
            toastr.success(`Image generated${result.withAvatar ? ' with avatar' : ''}!`, 'Nano Banana Pro');
        }

    } catch (error) {
        console.error(`[${extensionName}] Quick generation error:`, error);
        toastr.error(`Failed to generate: ${error.message}`, 'Nano Banana Pro');
    } finally {
        generateBtn.removeClass('generating');
        generateBtn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-bolt');
    }
}

function injectMessageButton(messageId) {
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (messageElement.length === 0) return;
    
    const extraButtons = messageElement.find('.extraMesButtons');
    if (extraButtons.length === 0) return;

    if (extraButtons.find('.nano_message_gen').length > 0) return;

    const nanoButton = $(`
        <div title="Generate with Nano Banana Pro 🍌" 
             class="mes_button nano_message_gen fa-solid fa-bolt" 
             data-i18n="[title]Generate with Nano Banana Pro 🍌">
        </div>
    `);

    const cigButton = extraButtons.find('.cig_message_gen');
    if (cigButton.length) {
        cigButton.after(nanoButton);
    } else {
        extraButtons.prepend(nanoButton);
    }
}

function injectAllMessageButtons() {
    $('.mes').each(function() {
        const messageId = $(this).attr('mesid');
        if (messageId !== undefined) {
            injectMessageButton(Number(messageId));
        }
    });
}

function updateStrengthValue() {
    const value = $('#nano_face_strength').val();
    $('#nano_strength_value').text(value);
}

function updateServiceTypeUI() {
    const serviceType = $('#nano_service_type').val();
    
    // Показываем/скрываем поля в зависимости от типа сервиса
    if (serviceType === 'custom') {
        $('#nano_request_format_container').show();
        $('#nano_avatar_field_container').show();
        $('#nano_prompt_field_container').show();
    } else {
        $('#nano_request_format_container').hide();
        $('#nano_avatar_field_container').hide();
        $('#nano_prompt_field_container').hide();
    }
}

jQuery(async () => {
    console.log(`[${extensionName}] Initializing extension...`);
    
    try {
        const response = await fetch(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
        const settingsHtml = await response.text();
        $('#extensions_settings').append(settingsHtml);
    } catch (error) {
        console.error(`[${extensionName}] Error loading settings template:`, error);
        toastr.error('Failed to load extension settings.', 'Nano Banana Pro');
        return;
    }

    await loadSettings();

    // Обработчики событий
    $('#nano_service_type').on('change', function() {
        extension_settings[extensionName].serviceType = $(this).val();
        updateServiceTypeUI();
        saveSettingsDebounced();
    });

    $('#nano_endpoint_url').on('input', function() {
        extension_settings[extensionName].endpointUrl = $(this).val();
        saveSettingsDebounced();
    });

    $('#nano_api_key').on('input', function() {
        extension_settings[extensionName].apiKey = $(this).val();
        saveSettingsDebounced();
    });

    $('#nano_use_avatar').on('change', function() {
        extension_settings[extensionName].useAvatarReference = $(this).prop('checked');
        saveSettingsDebounced();
        $('#nano_face_strength_container').toggle($(this).prop('checked'));
    });

    $('#nano_face_strength').on('input', function() {
        extension_settings[extensionName].faceReferenceStrength = $(this).val();
        saveSettingsDebounced();
        updateStrengthValue();
    });

    $('#nano_use_context').on('change', function() {
        extension_settings[extensionName].useCharacterContext = $(this).prop('checked');
        saveSettingsDebounced();
        $('#nano_context_depth_container').toggle($(this).prop('checked'));
    });

    $('#nano_context_depth').on('change', function() {
        let value = parseInt($(this).val(), 10);
        if (isNaN(value) || value < 1) value = 1;
        if (value > 10) value = 10;
        $(this).val(value);
        extension_settings[extensionName].messageContextDepth = value;
        saveSettingsDebounced();
    });

    // ... остальные обработчики аналогично ...

    $('#nano_request_format').on('change', function() {
        extension_settings[extensionName].requestFormat = $(this).val();
        saveSettingsDebounced();
    });

    $('#nano_avatar_field').on('input', function() {
        extension_settings[extensionName].avatarFieldName = $(this).val();
        saveSettingsDebounced();
    });

    $('#nano_prompt_field').on('input', function() {
        extension_settings[extensionName].promptFieldName = $(this).val();
        saveSettingsDebounced();
    });

    $('#nano_quick_generate').on('click', quickGenerate);

    $(document).on('click', '.nano_message_gen', function(e) {
        nanoMessageButton($(e.currentTarget));
    });

    // Показываем/скрываем поля при загрузке
    $('#nano_face_strength_container').toggle(extension_settings[extensionName].useAvatarReference);
    $('#nano_context_depth_container').toggle(extension_settings[extensionName].useCharacterContext);
    updateServiceTypeUI();

    // Инъекция кнопок
    eventSource.on(event_types.MESSAGE_RENDERED, (messageId) => {
        injectMessageButton(messageId);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(injectAllMessageButtons, 100);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        setTimeout(injectAllMessageButtons, 100);
    });

    setTimeout(injectAllMessageButtons, 500);

    console.log(`[${extensionName}] Extension loaded successfully!`);
});
