package handler

// Types in this file exist only so swag can describe the {"data": ...} envelope of each answer;
// the handlers keep writing it through writeData and writePage.

// MessageData is an answer that only carries a human readable message.
type MessageData struct {
	Data struct {
		Message string `json:"message"`
	} `json:"data"`
} // @name MessageResponse

// UserData answers with one user.
type UserData struct {
	Data userBody `json:"data"`
} // @name UserResponse

// SessionData answers with a user and the tokens that sign them in.
type SessionData struct {
	Data sessionBody `json:"data"`
} // @name SessionResponse
