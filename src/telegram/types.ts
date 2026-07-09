// Minimal Telegram Bot API types: only the fields this bridge reads or sends.

export type ApiResponse<T> =
  | { ok: true; result: T }
  | {
      ok: false
      error_code: number
      description: string
      parameters?: { retry_after?: number }
    }

export interface User {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

export interface Chat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

export interface Message {
  message_id: number
  date: number
  chat: Chat
  from?: User
  text?: string
}

export interface CallbackQuery {
  id: string
  from: User
  message?: Message
  data?: string
}

export interface Update {
  update_id: number
  message?: Message
  callback_query?: CallbackQuery
}

export interface InlineKeyboardButton {
  text: string
  callback_data?: string
  url?: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

export type ChatAction = 'typing' | 'upload_photo' | 'upload_document'

export interface SendMessageParams {
  chat_id: number
  text: string
  parse_mode?: 'HTML'
  reply_markup?: InlineKeyboardMarkup
  disable_notification?: boolean
}

export interface EditMessageTextParams {
  chat_id: number
  message_id: number
  text: string
  parse_mode?: 'HTML'
  reply_markup?: InlineKeyboardMarkup
}

export interface AnswerCallbackQueryParams {
  callback_query_id: string
  text?: string
  show_alert?: boolean
}

export interface ReactionTypeEmoji {
  type: 'emoji'
  emoji: string
}

export interface SetMessageReactionParams {
  chat_id: number
  message_id: number
  reaction?: ReactionTypeEmoji[]
}

// Normalized shape the rest of the bridge consumes. Nothing outside
// src/telegram should ever touch a raw Update.
export type IncomingMessage =
  | {
      kind: 'text'
      chatId: number
      userId: number
      messageId: number
      text: string
    }
  | {
      kind: 'callback'
      chatId: number
      userId: number
      messageId: number
      callbackId: string
      callbackData?: string
    }
