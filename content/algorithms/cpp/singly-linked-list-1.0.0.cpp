#include <iostream>
// @phase types
struct Node {
    int value;
    Node* next;
};
// @phase traverse
void printList(Node* head) {
    std::cout << "LIST";
    for (Node* current = head; current != nullptr; current = current->next) {
        std::cout << " " << current->value;
    }
    std::cout << "\n";
}
// @phase setup
int main() {
    int encodedLength = {{n}};
    Node* head = nullptr;
    int size = 0;
    int consumed = 0;
    int processed = 0;
    int outcome = 0;
    // @phase read
    while (consumed < encodedLength) {
        outcome = 0;
        int command;
        std::cin >> command;
        consumed = consumed + 1;
        // @phase insert
        if (command == 1) {
            int position;
            int value;
            std::cin >> position >> value;
            consumed = consumed + 2;
            if (position < 0 || position > size) {
                outcome = 5;
                std::cout << "RANGE " << position << "\n";
            } else if (size == 7) {
                outcome = 4;
                std::cout << "FULL " << value << "\n";
            } else {
                // @phase allocate
                Node* node = new Node{};
                node->value = value;
                // @phase link
                if (position == 0) {
                    node->next = head;
                    head = node;
                } else {
                    Node* prev = head;
                    int index = 1;
                    while (index < position) {
                        prev = prev->next;
                        index = index + 1;
                    }
                    node->next = prev->next;
                    prev->next = node;
                }
                size = size + 1;
                outcome = 1;
                std::cout << "INSERT " << value << "\n";
            }
        // @phase remove
        } else if (command == 2) {
            int position;
            std::cin >> position;
            consumed = consumed + 1;
            if (position < 0 || position >= size) {
                outcome = 5;
                std::cout << "RANGE " << position << "\n";
            } else {
                Node* target;
                if (position == 0) {
                    target = head;
                    head = target->next;
                } else {
                    Node* prev = head;
                    int index = 1;
                    while (index < position) {
                        prev = prev->next;
                        index = index + 1;
                    }
                    target = prev->next;
                    prev->next = target->next;
                }
                // @phase release
                int removed = target->value;
                delete target;
                size = size - 1;
                outcome = 2;
                std::cout << "DELETE " << removed << "\n";
            }
        // @phase visit
        } else if (command == 3) {
            printList(head);
            outcome = 3;
        // @phase invalid
        } else {
            outcome = 9;
            std::cout << "INVALID " << command << "\n";
            return 1;
        }
        // @phase advance
        processed = processed + 1;
    }
    // @phase cleanup
    while (head != nullptr) {
        Node* target = head;
        head = target->next;
        delete target;
        size = size - 1;
    }
    // @phase finish
    std::cout << "END\n";
    return 0;
}
