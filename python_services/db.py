import os
import datetime
from sqlalchemy import create_engine, Column, String, DateTime, ForeignKey, Index
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

# Database URL pointing to postgres defined in docker-compose
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:nexis_postgres@localhost:5433/nexis_chat")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Project(Base):
    __tablename__ = "Project"
    
    id = Column(String, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)
    createdAt = Column(DateTime, default=datetime.datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    
    documents = relationship("Document", back_populates="project")

class Document(Base):
    __tablename__ = "Document"
    
    id = Column(String, primary_key=True)
    filename = Column(String, nullable=False)
    version = Column(String, default="v1.0")
    projectId = Column(String, ForeignKey("Project.id", ondelete="SET NULL"), nullable=True)
    jiraId = Column(String, nullable=True)
    # QUEUED, PROCESSING, EFFECTIVE, NEEDS_REVIEW, ARCHIVED
    status = Column(String, default="QUEUED")
    error_message = Column(String, nullable=True)
    createdAt = Column(DateTime, default=datetime.datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    
    project = relationship("Project", back_populates="documents")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
