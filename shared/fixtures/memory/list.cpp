#include <iostream>
struct Node {
    int value;
    Node* next;
};
Node* make(int value, Node* next) {
    Node* node = new Node{};
    node->value = value;
    node->next = next;
    return node;
}
void print(Node* head) {
    for (Node* p = head; p != nullptr; p = p->next) {
        std::cout << p->value << " ";
    }
    std::cout << "\n";
}
int main() {
    int a;
    int b;
    int c;
    std::cin >> a >> b >> c;
    Node* tail = make(c, nullptr);
    Node* middle = make(b, tail);
    Node* head = make(a, middle);
    print(head);
    head->next = tail;
    delete middle;
    print(head);
    delete head;
    delete tail;
    return 0;
}
