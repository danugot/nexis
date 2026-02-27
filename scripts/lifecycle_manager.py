import os
import sys
import argparse
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')

class LifecycleManager:
    def __init__(self):
        self.driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    def close(self):
        self.driver.close()

    def list_documents(self):
        query = """
        MATCH (d:Document)
        RETURN d.name as name, d.status as status, d.version as version, d.ingested_at as date
        ORDER BY d.ingested_at DESC
        """
        with self.driver.session() as session:
            result = session.run(query)
            print(f"\n{'DOCUMENT NAME':<50} | {'STATUS':<12} | {'VERSION':<10} | {'DATE'}")
            print("-" * 100)
            for r in result:
                status = r['status'] or 'EFFECTIVE' # Default for legacy docs
                version = r['version'] or 'v1.0'
                date = r['date'] or 'N/A'
                print(f"{r['name']:<50} | {status:<12} | {version:<10} | {date}")
            print("-" * 100)

    def set_status(self, doc_name, status):
        if status not in ['EFFECTIVE', 'ARCHIVED', 'DRAFT']:
            print(f"Invalid status: {status}")
            return

        query = """
        MATCH (d:Document {name: $name})
        SET d.status = $status, d.updated_at = datetime()
        RETURN d.name, d.status
        """
        with self.driver.session() as session:
            result = session.run(query, name=doc_name, status=status)
            record = result.single()
            if record:
                print(f"✅ Updated '{doc_name}' status to '{status}'")
            else:
                print(f"❌ Document '{doc_name}' not found.")

def main():
    parser = argparse.ArgumentParser(description="Nexis Knowledge Lifecycle Manager")
    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # List command
    subparsers.add_parser('list', help='List all documents and their status')

    # Archive command
    archive_parser = subparsers.add_parser('archive', help='Archive a document')
    archive_parser.add_argument('name', help='Document name')

    # Activate command
    activate_parser = subparsers.add_parser('activate', help='Activate a document')
    activate_parser.add_argument('name', help='Document name')

    args = parser.parse_args()
    
    manager = LifecycleManager()
    
    try:
        if args.command == 'list':
            manager.list_documents()
        elif args.command == 'archive':
            manager.set_status(args.name, 'ARCHIVED')
        elif args.command == 'activate':
            manager.set_status(args.name, 'EFFECTIVE')
        else:
            parser.print_help()
    finally:
        manager.close()

if __name__ == "__main__":
    main()
