from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime

class ImpactEnum(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class ChangeTypeEnum(str, Enum):
    ADDED = "ADDED"
    MODIFIED = "MODIFIED"
    DELETED = "DELETED"

class MAP(BaseModel):
    map_id: str = Field(..., description="Unique identifier for the compliance MAP")
    clause_ref: str = Field(..., description="Reference ID mapping back to the normalized historical clause")
    change_type: ChangeTypeEnum
    change_reason: str = Field(..., description="Why did the regulator make this change?")
    impact: ImpactEnum
    summary: str = Field(..., description="1-2 sentence executive summary of the change.")
    old_obligation: Optional[str] = Field(None, description="Previous rule, if any.")
    new_obligation: str = Field(..., description="New rule to be followed.")
    affected_department: str = Field(..., description="Department responsible for action.")
    deadline: Optional[datetime] = Field(None, description="Date when this takes effect.")
    source_circular: str = Field(..., description="The ID of the circular that generated this MAP")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score of the evaluation (0.0 to 1.0)")

class IncomingChunk(BaseModel):
    circular_id: str
    circular_date: str
    regulator: str
    domain: str
    section_title: str
    chunk_text: str
    chunk_index: int
    chunk_hash: str = Field(..., description="The hash computed by Node 1")
    
