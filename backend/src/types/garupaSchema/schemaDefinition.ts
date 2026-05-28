export type ProtoDataType = "int" | "string" | "bool" | "float" | "double" | "message" | "bytes";

export interface FieldDefinition {
    name: string;
    type: ProtoDataType;
    repeated?: boolean;
    // 当 type 为 'message' 时，必须指定子消息的 Schema 配置
    schema?: SchemaDefinition;
}

// Key 为 Protobuf 的 Tag 号 (fieldNumber)
export interface SchemaDefinition {
    [fieldNumber: number]: FieldDefinition;
}
