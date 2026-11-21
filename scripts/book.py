#   This is the book engine
#   This script includes functions and classes that builds the derivative book compiled with other positions

#   David Smith

from derivatives import Derivative
from market import Market

class Position:
    name: str
    derivative: Derivative
    quantity: float

    def __init__(self, name, derivative, quantity):
        self.name = name
        self.derivative = derivative
        self.quantity = quantity

class Book:
    book: Position

    def __init__(self, book=None):
        self.book = []
        if book is not None:
            for p in book:
                self.add(p)
        

    def add(self, position):
        for p in self.book:
            if p.name == position.name:
                raise ValueError(f"position '{position.name}' already in book")
        self.book.append(position)

    def remove(self, name="str"):
        for i in range(len(self.book)):
            if self.book[i].name == name:
                del self.book[i]
                return
        raise KeyError(f"no position named '{name}'")

    def value(self, market):
        value: float = 0
        for i in range(len(self.book)):
            value+= self.book[i].derivative.price(market) * self.book[i].quantity
        return value

    def position_values(self, market):
        values = {}
        for p in self.book:
            values[p.name] = p.derivative.price(market) * p.quantity
        return values

if __name__ == "__main__":
    from derivatives import EuropeanCallOption, Future

    base = Market(
        time=0.0,
        rate=0.04,
        spots={"SPX": 6000.0, "XYZ": 42.0},
        vols={"SPX": 0.18, "XYZ": 0.35},
        div_yields={"SPX": 0.013, "XYZ": 0.0},
        credit_spreads={"XYZ": 0.025},
    )

    call = Position("SPX 6000 call", EuropeanCallOption("SPX", 6000, 0.5), 10)
    fut = Position("SPX future", Future("SPX", 0.5), -2)

    # 1. build a book from a list, and an empty one
    book = Book([call, fut])
    empty = Book()
    print("empty book value:", empty.value(base))           # 0.0

    # 2. value and position values
    print("position values:", book.position_values(base))   # call ~3421.10, future ~-12163.10
    print("book value:", book.value(base))                  # ~-8742.00, the sum of the two

    # 3. duplicate name is rejected
    try:
        book.add(Position("SPX 6000 call", EuropeanCallOption("SPX", 6000, 1.0), 5))
        print("duplicate guard FAILED")
    except ValueError:
        print("duplicate guard works")

    # 4. remove works, and removing a missing name raises
    book.remove("SPX future")
    print("after remove:", book.position_values(base))      # only the call left
    try:
        book.remove("SPX future")
        print("remove guard FAILED")
    except KeyError:
        print("remove guard works")